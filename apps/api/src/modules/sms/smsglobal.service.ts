import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';

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
  private readonly origin = process.env.SMSGLOBAL_SENDER_ID || 'PartsBazar';
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

  /** `phone` must already be E.164-normalized (leading `+`, digits only after). */
  async sendOtpSms(phone: string, code: string): Promise<void> {
    const message = `Your PartsBazar360 verification code is ${code}. It expires in 5 minutes.`;

    if (!this.apiKey || !this.apiSecret) {
      this.logger.warn(
        `SMS provider is not configured; verification message was not sent to ${phone.slice(0, 4)}***${phone.slice(-4)}`,
      );
      throw new ServiceUnavailableException(
        'Text message verification is temporarily unavailable',
      );
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
      this.logger.error(`SMSGlobal send failed (${response.status})`);
      throw new Error('Failed to send SMS verification code');
    }
  }
}
