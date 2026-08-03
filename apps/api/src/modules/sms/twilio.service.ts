import { Injectable, Logger } from '@nestjs/common';
import twilio, { type Twilio } from 'twilio';

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private client: Twilio | null = null;
  private verifyServiceSid: string | null = null;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID || null;

    if (accountSid && authToken && this.verifyServiceSid) {
      this.client = twilio(accountSid, authToken);
      this.logger.log('Twilio Verify service initialized');
    } else {
      this.logger.warn(
        'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_VERIFY_SERVICE_SID not set — SMS codes will be logged but not sent',
      );
    }
  }

  async startVerification(phone: string): Promise<void> {
    if (!this.client || !this.verifyServiceSid) {
      this.logger.log(`[DRY RUN] Would send SMS verification code to ${phone}`);
      return;
    }
    await this.client.verify.v2
      .services(this.verifyServiceSid)
      .verifications.create({ to: phone, channel: 'sms' });
  }

  async checkVerification(phone: string, code: string): Promise<boolean> {
    if (!this.client || !this.verifyServiceSid) {
      this.logger.log(
        `[DRY RUN] Accepting any code for ${phone} — Twilio is not configured`,
      );
      return true;
    }
    const check = await this.client.verify.v2
      .services(this.verifyServiceSid)
      .verificationChecks.create({ to: phone, code });
    return check.status === 'approved';
  }
}
