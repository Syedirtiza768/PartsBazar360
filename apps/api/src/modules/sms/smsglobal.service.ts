import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';

const MAX_PROVIDER_RESPONSE_LOG_LENGTH = 4_000;
const SENSITIVE_RESPONSE_KEYS = new Set([
  'authorization',
  'apikey',
  'apisecret',
  'destination',
  'mac',
  'mobile',
  'nonce',
  'number',
  'otp',
  'password',
  'phone',
  'phonenumber',
  'recipient',
  'secret',
  'token',
  'to',
  'verificationcode',
]);

/**
 * SMSGlobal REST API v2 client. Unlike Twilio Verify, this is a plain
 * send-SMS API with no hosted OTP/verify service — code generation, storage,
 * and expiry are handled by the caller (see AuthService.sendPhoneOtp).
 *
 * Auth is a keyed-HMAC "MAC" scheme (SMSGlobal-specific, not OAuth2 MAC):
 * https://www.smsglobal.com/us/rest-api/
 */
@Injectable()
export class SmsGlobalService {
  private readonly logger = new Logger(SmsGlobalService.name);
  private readonly apiKey = process.env.SMSGLOBAL_API_KEY || null;
  private readonly apiSecret = process.env.SMSGLOBAL_API_SECRET || null;
  private readonly origin = process.env.SMSGLOBAL_SENDER_ID || 'SMSGlobal';
  private readonly host = 'api.smsglobal.com';
  private readonly path = '/v2/sms/';

  constructor() {
    if (this.apiKey && this.apiSecret) {
      this.logger.log('SMSGlobal REST client initialized');
    } else {
      this.logger.warn(
        'SMSGLOBAL_API_KEY/SMSGLOBAL_API_SECRET not set — SMS codes will be logged but not sent',
      );
    }
  }

  private authHeader(method: 'POST'): string {
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const stringToSign = `${ts}\n${nonce}\n${method}\n${this.path}\n${this.host}\n443\n\n`;
    const mac = createHmac('sha256', this.apiSecret as string)
      .update(stringToSign)
      .digest('base64');
    return `MAC id="${this.apiKey}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;
  }

  private redactText(value: string): string {
    return value
      .replace(/\+?[0-9][0-9\s().-]{7,}[0-9]/g, '[REDACTED_PHONE]')
      .replace(/\b[0-9]{6}\b/g, '[REDACTED_CODE]');
  }

  private sanitizeResponseValue(value: unknown, key?: string): unknown {
    if (
      key &&
      SENSITIVE_RESPONSE_KEYS.has(key.replace(/[\s_-]/g, '').toLowerCase())
    ) {
      return '[REDACTED]';
    }
    if (typeof value === 'string') return this.redactText(value);
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeResponseValue(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          this.sanitizeResponseValue(entryValue, entryKey),
        ]),
      );
    }
    return value;
  }

  private sanitizeResponseBody(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return '<empty>';

    try {
      return JSON.stringify(this.sanitizeResponseValue(JSON.parse(trimmed)));
    } catch {
      return this.redactText(trimmed);
    }
  }

  /** `phone` must already be E.164-normalized (leading `+`, digits only after). */
  private async sendMessage(
    phone: string,
    message: string,
    unavailableMessage: string,
    failureMessage: string,
  ): Promise<void> {
    if (!this.apiKey || !this.apiSecret) {
      this.logger.warn(
        `SMS provider is not configured; message was not sent to ${phone.slice(0, 4)}***${phone.slice(-4)}`,
      );
      throw new ServiceUnavailableException(unavailableMessage);
    }

    const destination = phone.replace(/^\+/, '');
    const response = await fetch(`https://${this.host}${this.path}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader('POST'),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        messages: [{ destination, message, origin: this.origin }],
      }),
    });

    if (!response.ok) {
      let rawResponseBody = '';
      try {
        rawResponseBody = await response.text();
      } catch {
        rawResponseBody = '<unreadable>';
      }
      const requestId =
        response.headers.get('x-request-id') ??
        response.headers.get('x-smglobal-request-id');
      this.logger.error(
        `SMSGlobal send failed ${JSON.stringify({
          status: response.status,
          requestId: requestId || undefined,
          responseBody: this.sanitizeResponseBody(rawResponseBody).slice(
            0,
            MAX_PROVIDER_RESPONSE_LOG_LENGTH,
          ),
        })}`,
      );
      throw new Error(failureMessage);
    }
  }

  async sendOtpSms(phone: string, code: string): Promise<void> {
    await this.sendMessage(
      phone,
      `Your PartsBazar360 verification code is ${code}. It expires in 5 minutes.`,
      'Text message verification is temporarily unavailable',
      'Failed to send SMS verification code',
    );
  }

  async sendOrderConfirmationSms(
    phone: string,
    order: {
      orderId: string;
      totalAmount: number;
      currency: string;
    },
  ): Promise<void> {
    await this.sendMessage(
      phone,
      `PartsBazar360: Order ${order.orderId} is confirmed. Total ${order.currency} ${order.totalAmount.toFixed(2)}. We will notify you when it ships.`,
      'Order confirmation SMS is temporarily unavailable',
      'Failed to send order confirmation SMS',
    );
  }
}
