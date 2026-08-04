import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SendGridService {
  private readonly logger = new Logger(SendGridService.name);
  private apiKey: string | null;
  private fromEmail: string;
  private fromName: string;

  constructor() {
    this.apiKey = process.env.SENDGRID_API_KEY || null;
    this.fromEmail =
      process.env.SENDGRID_FROM_EMAIL || 'info@partsbazar360.com';
    this.fromName = process.env.SENDGRID_FROM_NAME || 'PartsBazar360';

    if (this.apiKey) {
      this.logger.log('SendGrid email service initialized');
    } else {
      this.logger.warn(
        'SENDGRID_API_KEY not set — emails will be logged but not sent',
      );
    }
  }

  async sendOtpCode(to: string, code: string): Promise<void> {
    const subject = `Your PartsBazar360 code: ${code}`;
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h1 style="font-size:20px;">Your verification code</h1>
        <p>Use the following code to confirm your checkout. This code expires in 10 minutes.</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:4px;background:#f4f4f5;padding:12px 20px;border-radius:6px;display:inline-block;">${code}</div>
        <p style="font-size:13px;color:#71717a;">If you didn't request this code, you can safely ignore this email.</p>
      </div>
    `;
    await this.send(to, subject, html);
  }

  /** General-purpose transactional send, shared by EmailService's templated notifications. */
  async send(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    if (!this.apiKey) {
      this.logger.log(`[DRY RUN] To: ${to} | Subject: ${subject}`);
      return;
    }

    const content: Array<{ type: string; value: string }> = [];
    if (text) content.push({ type: 'text/plain', value: text });
    content.push({ type: 'text/html', value: html });

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.fromEmail, name: this.fromName },
        subject,
        content,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Failed to send email to ${to}: ${res.status} ${body}`);
      throw new Error(`SendGrid send failed with status ${res.status}`);
    }
    this.logger.log(`Email sent to ${to}: ${subject}`);
  }
}
