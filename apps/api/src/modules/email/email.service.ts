import { Injectable, Logger } from '@nestjs/common';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private mailersend: MailerSend | null = null;
  private fromEmail: string;
  private fromName: string;
  private buyerAppUrl: string;

  constructor() {
    const apiKey = process.env.MAILERSEND_API_KEY;
    this.fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'info@partsbazar360.com';
    this.fromName = process.env.MAILERSEND_FROM_NAME || 'PartsBazar360';
    this.buyerAppUrl = process.env.BUYER_APP_URL || 'http://localhost:3000';

    if (apiKey) {
      this.mailersend = new MailerSend({ apiKey });
      this.logger.log('MailerSend email service initialized');
    } else {
      this.logger.warn(
        'MAILERSEND_API_KEY not set — emails will be logged but not sent',
      );
    }
  }

  private async send(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    if (!this.mailersend) {
      this.logger.log(`[DRY RUN] To: ${to} | Subject: ${subject}`);
      this.logger.debug(`[DRY RUN] HTML: ${html.substring(0, 200)}...`);
      return;
    }

    const emailParams = new EmailParams()
      .setFrom(new Sender(this.fromEmail, this.fromName))
      .setTo([new Recipient(to)])
      .setSubject(subject)
      .setHtml(html)
      .setText(text || this.stripHtml(html));

    try {
      await this.mailersend.email.send(emailParams);
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${err}`);
      throw err;
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private layout(content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PartsBazar360</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 32px 16px; }
    .card { background: #ffffff; border-radius: 8px; padding: 32px; border: 1px solid #e4e4e7; }
    .logo { font-size: 20px; font-weight: 800; color: #18181b; letter-spacing: -0.5px; margin-bottom: 24px; }
    h1 { font-size: 22px; font-weight: 700; color: #18181b; margin: 0 0 12px; }
    p { font-size: 15px; color: #52525b; line-height: 1.6; margin: 0 0 16px; }
    .btn { display: inline-block; background: #18181b; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 15px; font-weight: 600; margin: 8px 0 16px; }
    .code { font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #18181b; background: #f4f4f5; padding: 12px 20px; border-radius: 6px; display: inline-block; margin: 8px 0; }
    .footer { font-size: 12px; color: #a1a1aa; text-align: center; margin-top: 24px; line-height: 1.5; }
    .divider { border: none; border-top: 1px solid #e4e4e7; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo">PartsBazar360</div>
      ${content}
    </div>
    <div class="footer">
      PartsBazar360 &mdash; Auto parts marketplace<br />
      If you didn't request this email, you can safely ignore it.
    </div>
  </div>
</body>
</html>`;
  }

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const verifyUrl = `${this.buyerAppUrl}/verify-email?token=${token}`;
    const html = this.layout(`
      <h1>Verify your email</h1>
      <p>Thanks for signing up! Please verify your email address to activate your PartsBazar360 account.</p>
      <a href="${verifyUrl}" class="btn">Verify email address</a>
      <p style="font-size:13px;color:#71717a;">Or copy this link into your browser:<br />
      <span style="word-break:break-all;">${verifyUrl}</span></p>
      <p style="font-size:13px;color:#71717a;">This link expires in 24 hours.</p>
    `);
    await this.send(to, 'Verify your PartsBazar360 email', html);
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const resetUrl = `${this.buyerAppUrl}/reset-password?token=${token}`;
    const html = this.layout(`
      <h1>Reset your password</h1>
      <p>We received a request to reset the password for your PartsBazar360 account.</p>
      <a href="${resetUrl}" class="btn">Reset password</a>
      <p style="font-size:13px;color:#71717a;">Or copy this link into your browser:<br />
      <span style="word-break:break-all;">${resetUrl}</span></p>
      <p style="font-size:13px;color:#71717a;">This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.</p>
    `);
    await this.send(to, 'Reset your PartsBazar360 password', html);
  }

  async sendOrderConfirmation(
    to: string,
    order: {
      orderId: string;
      totalAmount: number;
      currency: string;
      items: Array<{ name: string; quantity: number; unitPrice: number }>;
      shippingAddress?: string;
    },
  ): Promise<void> {
    const itemsHtml = order.items
      .map(
        (item) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;font-size:14px;color:#18181b;">${item.name}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;font-size:14px;color:#52525b;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;font-size:14px;color:#18181b;text-align:right;">${order.currency} ${(item.unitPrice * item.quantity).toFixed(2)}</td>
      </tr>`,
      )
      .join('');

    const html = this.layout(`
      <h1>Order confirmed!</h1>
      <p>Thank you for your order. We've received your payment and your order is being processed.</p>
      <p><strong>Order ID:</strong> ${order.orderId}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="border-bottom:2px solid #e4e4e7;">
            <th style="padding:8px 0;text-align:left;font-size:12px;color:#a1a1aa;text-transform:uppercase;font-weight:600;">Item</th>
            <th style="padding:8px 0;text-align:center;font-size:12px;color:#a1a1aa;text-transform:uppercase;font-weight:600;">Qty</th>
            <th style="padding:8px 0;text-align:right;font-size:12px;color:#a1a1aa;text-transform:uppercase;font-weight:600;">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding:12px 0;font-size:15px;font-weight:700;color:#18181b;text-align:right;">Total</td>
            <td style="padding:12px 0;font-size:15px;font-weight:700;color:#18181b;text-align:right;">${order.currency} ${order.totalAmount.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
      ${order.shippingAddress ? `<p><strong>Shipping to:</strong><br/>${order.shippingAddress}</p>` : ''}
      <a href="${this.buyerAppUrl}/account/purchases" class="btn">View order</a>
      <p style="font-size:13px;color:#71717a;">You'll receive another email when your order ships.</p>
    `);
    await this.send(to, `Order confirmed — ${order.orderId}`, html);
  }
}
