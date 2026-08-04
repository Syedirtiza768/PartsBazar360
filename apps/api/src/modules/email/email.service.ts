import { Injectable, Logger } from '@nestjs/common';
import { SendGridService } from './sendgrid.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private buyerAppUrl: string;
  /** Where admin notifications are delivered (info@partsbazar360.com). */
  private adminEmail: string;
  private adminAppUrl: string;

  constructor(private readonly sendGridService: SendGridService) {
    this.buyerAppUrl = process.env.BUYER_APP_URL || 'http://localhost:3000';
    this.adminEmail = process.env.ADMIN_EMAIL || 'info@partsbazar360.com';
    this.adminAppUrl =
      process.env.ADMIN_APP_URL || 'http://localhost:3002/admin';
  }

  // --- Private helpers ------------------------------------------

  private async send(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    try {
      await this.sendGridService.send(
        to,
        subject,
        html,
        text || this.stripHtml(html),
      );
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${err}`);
      throw err;
    }
  }

  /** Fire-and-forget wrapper that swallows errors (for non-critical notifications). */
  private fireAndForget(promise: Promise<void>, context: string): void {
    void promise.catch((err) => this.logger.error(`${context}: ${err}`));
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
    .btn-outline { display: inline-block; background: #ffffff; color: #18181b !important; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 15px; font-weight: 600; margin: 8px 0 16px; border: 1px solid #d4d4d8; }
    .code { font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #18181b; background: #f4f4f5; padding: 12px 20px; border-radius: 6px; display: inline-block; margin: 8px 0; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-warning { background: #fef3c7; color: #92400e; }
    .badge-info { background: #dbeafe; color: #1e40af; }
    .badge-danger { background: #fee2e2; color: #991b1b; }
    .field { font-size: 13px; color: #71717a; margin: 4px 0; }
    .field strong { color: #18181b; }
    .msg-block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 12px 0; font-size: 14px; color: #374151; line-height: 1.6; white-space: pre-wrap; }
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
      If you didn&rsquo;t request this email, you can safely ignore it.
    </div>
  </div>
</body>
</html>`;
  }

  // --- Buyer emails ---------------------------------------------

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

  async sendOtpCode(to: string, code: string): Promise<void> {
    const html = this.layout(`
      <h1>Your verification code</h1>
      <p>Use the following code to sign in to your PartsBazar360 account. This code expires in 10 minutes.</p>
      <div class="code">${code}</div>
      <p style="font-size:13px;color:#71717a;">If you didn't request this code, you can safely ignore this email.</p>
    `);
    await this.send(to, `Your PartsBazar360 code: ${code}`, html);
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
    await this.send(to, `Order confirmed � ${order.orderId}`, html);
  }

  // --- Buyer shipment notification ------------------------------

  async sendShipmentNotification(
    to: string,
    shipment: {
      orderId: string;
      sellerName: string;
      trackingNumber: string;
      carrier?: string;
      items: Array<{ name: string; quantity: number }>;
    },
  ): Promise<void> {
    const itemsHtml = shipment.items
      .map(
        (item) =>
          `<li style="padding:4px 0;font-size:14px;color:#18181b;">${item.quantity} &times; ${item.name}</li>`,
      )
      .join('');

    const html = this.layout(`
      <h1>Your order has shipped!</h1>
      <p>Order <strong>${shipment.orderId}</strong> from <strong>${shipment.sellerName}</strong> is on its way.</p>
      <hr class="divider" />
      <p class="field"><strong>Tracking number:</strong> ${shipment.trackingNumber}</p>
      ${shipment.carrier ? `<p class="field"><strong>Carrier:</strong> ${shipment.carrier}</p>` : ''}
      <p style="margin-top:16px;font-weight:600;color:#18181b;">Items in this shipment:</p>
      <ul style="padding-left:20px;margin:8px 0 16px;">${itemsHtml}</ul>
      <a href="${this.buyerAppUrl}/account/purchases/${encodeURIComponent(shipment.orderId)}" class="btn">View order details</a>
    `);
    await this.send(
      to,
      `Order shipped � ${shipment.orderId} (tracking: ${shipment.trackingNumber})`,
      html,
    );
  }

  // --- Ticket reply to buyer ------------------------------------

  async sendTicketReply(
    to: string,
    ticket: {
      ticketId: string;
      subject: string;
      customerName?: string;
      replyMessage: string;
    },
  ): Promise<void> {
    const html = this.layout(`
      <h1>Reply to your support request</h1>
      ${ticket.customerName ? `<p>Hi ${ticket.customerName},</p>` : '<p>Hi,</p>'}
      <p>Our team has replied to your support ticket <strong>${ticket.ticketId}</strong>.</p>
      <p class="field"><strong>Subject:</strong> ${ticket.subject}</p>
      <hr class="divider" />
      <div class="msg-block">${ticket.replyMessage}</div>
      <a href="${this.buyerAppUrl}/support" class="btn-outline">Open support</a>
    `);
    await this.send(
      to,
      `Re: ${ticket.subject} [Ticket ${ticket.ticketId}]`,
      html,
    );
  }

  // --- Admin notification (to info@partsbazar360.com) -----------

  /** Sends a notification to the admin inbox (info@partsbazar360.com). */
  async sendAdminNotification(
    subject: string,
    htmlBody: string,
  ): Promise<void> {
    const html = this.layout(`
      <span class="badge badge-info">Admin Alert</span>
      <h1 style="margin-top:16px;">${subject}</h1>
      ${htmlBody}
    `);
    await this.send(this.adminEmail, `[Admin] ${subject}`, html);
  }

  /** Notify admin that a new support ticket was created. */
  sendNewTicketAdminNotification(ticket: {
    id: string;
    category: string;
    subject: string;
    customerEmail: string;
    customerName?: string;
    message: string;
    priority: string;
    shippingCountry?: string;
    estimatedWeightKg?: number;
  }): void {
    const priorityBadge =
      ticket.priority === 'HIGH'
        ? '<span class="badge badge-danger">HIGH</span>'
        : '<span class="badge badge-warning">NORMAL</span>';

    const freightFields =
      ticket.shippingCountry || ticket.estimatedWeightKg
        ? `
      ${ticket.shippingCountry ? `<p class="field"><strong>Shipping to:</strong> ${ticket.shippingCountry}</p>` : ''}
      ${ticket.estimatedWeightKg ? `<p class="field"><strong>Estimated weight:</strong> ${ticket.estimatedWeightKg}kg</p>` : ''}
    `
        : '';

    const ticketUrl = `${this.adminAppUrl}/support/${ticket.id}/`;
    const html = `
      ${priorityBadge}
      <p class="field"><strong>Category:</strong> ${ticket.category}</p>
      <p class="field"><strong>From:</strong> ${ticket.customerName || 'Unknown'} &lt;${ticket.customerEmail}&gt;</p>
      <p class="field"><strong>Ticket ID:</strong> ${ticket.id}</p>
      ${freightFields}
      <hr class="divider" />
      <p style="font-weight:600;color:#18181b;">${ticket.subject}</p>
      <div class="msg-block">${ticket.message}</div>
      <a href="${ticketUrl}" class="btn">View in Admin Console</a>
    `;
    this.fireAndForget(
      this.sendAdminNotification(
        `New ${ticket.category} ticket � ${ticket.subject}`,
        html,
      ),
      `Admin ticket notification (${ticket.id})`,
    );
  }

  /** Notify admin that a new order was placed (and buyer confirmed). */
  sendNewOrderAdminNotification(order: {
    orderId: string;
    totalAmount: number;
    currency: string;
    buyerEmail: string;
    itemCount: number;
    sellerCount: number;
  }): void {
    const opsUrl = `${this.adminAppUrl}/operations/`;
    const html = `
      <span class="badge badge-info">New Order</span>
      <p class="field"><strong>Order ID:</strong> ${order.orderId}</p>
      <p class="field"><strong>Buyer:</strong> ${order.buyerEmail}</p>
      <p class="field"><strong>Items:</strong> ${order.itemCount} across ${order.sellerCount} seller(s)</p>
      <p class="field"><strong>Total:</strong> ${order.currency} ${order.totalAmount.toFixed(2)}</p>
      <hr class="divider" />
      <a href="${opsUrl}" class="btn">View in Admin Console</a>
    `;
    this.fireAndForget(
      this.sendAdminNotification(
        `New order ${order.orderId} � ${order.currency} ${order.totalAmount.toFixed(2)}`,
        html,
      ),
      `Admin order notification (${order.orderId})`,
    );
  }

  /** Notify admin that a seller onboarding status changed. */
  sendSellerOnboardingAdminNotification(seller: {
    sellerId: string;
    sellerName: string;
    previousStatus: string;
    newStatus: string;
    notes?: string;
  }): void {
    const opsUrl = `${this.adminAppUrl}/sellers/`;
    const html = `
      <span class="badge badge-warning">Seller Onboarding</span>
      <p class="field"><strong>Seller:</strong> ${seller.sellerName} (${seller.sellerId})</p>
      <p class="field"><strong>Status change:</strong> ${seller.previousStatus} &rarr; ${seller.newStatus}</p>
      ${seller.notes ? `<p class="field"><strong>Notes:</strong> ${seller.notes}</p>` : ''}
      <hr class="divider" />
      <a href="${opsUrl}" class="btn">View in Admin Console</a>
    `;
    this.fireAndForget(
      this.sendAdminNotification(
        `Seller ${seller.sellerName}: ${seller.previousStatus} ? ${seller.newStatus}`,
        html,
      ),
      `Admin seller notification (${seller.sellerId})`,
    );
  }
}
