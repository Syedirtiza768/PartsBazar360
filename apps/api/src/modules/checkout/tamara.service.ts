import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type TamaraCurrency = 'AED' | 'SAR';
export type TamaraCountryCode = 'AE' | 'SA';

type Money = {
  amount: number;
  currency: TamaraCurrency;
};

export type TamaraCheckoutItem = {
  referenceId: string;
  name: string;
  sku: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
};

export type TamaraCheckoutSession = {
  order_id: string;
  checkout_id: string;
  checkout_url: string;
  status: string;
};

export type TamaraWebhookPayload = {
  order_id: string;
  order_reference_id: string;
  order_number?: string;
  event_type:
    | 'order_approved'
    | 'order_declined'
    | 'order_authorised'
    | 'order_canceled'
    | 'order_updated'
    | 'order_captured'
    | 'order_refunded'
    | 'order_expired';
  data?: unknown;
};

@Injectable()
export class TamaraService {
  isConfigured(): boolean {
    return Boolean(process.env.TAMARA_API_TOKEN?.trim());
  }

  createCheckoutSession(input: {
    orderId: string;
    amount: number;
    shippingAmount: number;
    currency: TamaraCurrency;
    countryCode: TamaraCountryCode;
    customer: {
      email: string;
      firstName: string;
      lastName: string;
      phoneNumber: string;
    };
    shippingAddress: {
      line1: string;
      line2?: string;
      city: string;
      region?: string;
    };
    items: TamaraCheckoutItem[];
    successUrl: string;
    failureUrl: string;
    cancelUrl: string;
  }): Promise<TamaraCheckoutSession> {
    const money = (amount: number): Money => ({
      amount,
      currency: input.currency,
    });

    return this.request<TamaraCheckoutSession>('/checkout', {
      method: 'POST',
      body: JSON.stringify({
        order_reference_id: input.orderId,
        order_number: input.orderId,
        total_amount: money(input.amount),
        shipping_amount: money(input.shippingAmount),
        tax_amount: money(0),
        description: `PartsBazar360 order ${input.orderId}`,
        country_code: input.countryCode,
        payment_type: 'PAY_BY_INSTALMENTS',
        instalments: null,
        locale: 'en_US',
        is_mobile: false,
        consumer: {
          email: input.customer.email,
          first_name: input.customer.firstName,
          last_name: input.customer.lastName,
          phone_number: input.customer.phoneNumber,
        },
        shipping_address: {
          first_name: input.customer.firstName,
          last_name: input.customer.lastName,
          phone_number: input.customer.phoneNumber,
          line1: input.shippingAddress.line1,
          ...(input.shippingAddress.line2
            ? { line2: input.shippingAddress.line2 }
            : {}),
          city: input.shippingAddress.city,
          ...(input.shippingAddress.region
            ? { region: input.shippingAddress.region }
            : {}),
          country_code: input.countryCode,
        },
        items: input.items.map((item) => ({
          reference_id: item.referenceId,
          type: 'Physical',
          name: item.name.slice(0, 255),
          sku: item.sku.slice(0, 128),
          quantity: item.quantity,
          unit_price: money(item.unitAmount),
          total_amount: money(item.totalAmount),
          tax_amount: money(0),
          discount_amount: money(0),
        })),
        merchant_url: {
          success: input.successUrl,
          failure: input.failureUrl,
          cancel: input.cancelUrl,
        },
      }),
    });
  }

  authoriseOrder(orderId: string): Promise<{
    order_id: string;
    status: string;
    auto_captured?: boolean;
  }> {
    return this.request(`/orders/${encodeURIComponent(orderId)}/authorise`, {
      method: 'POST',
    });
  }

  captureOrder(input: {
    orderId: string;
    amount: number;
    shippingAmount: number;
    currency: TamaraCurrency;
    shippedAt: Date;
    shippingCompany: string;
    trackingNumber?: string;
    items: TamaraCheckoutItem[];
  }): Promise<{ order_id: string; capture_id: string; status: string }> {
    const money = (amount: number): Money => ({
      amount,
      currency: input.currency,
    });

    return this.request('/payments/capture', {
      method: 'POST',
      body: JSON.stringify({
        order_id: input.orderId,
        total_amount: money(input.amount),
        shipping_info: {
          shipped_at: input.shippedAt.toISOString(),
          shipping_company: input.shippingCompany.slice(0, 100),
          ...(input.trackingNumber
            ? { tracking_number: input.trackingNumber.slice(0, 100) }
            : {}),
        },
        items: input.items.map((item) => ({
          reference_id: item.referenceId,
          type: 'Physical',
          name: item.name.slice(0, 255),
          sku: item.sku.slice(0, 128),
          quantity: item.quantity,
          unit_price: money(item.unitAmount),
          total_amount: money(item.totalAmount),
          tax_amount: money(0),
          discount_amount: money(0),
        })),
        tax_amount: money(0),
        discount_amount: money(0),
        shipping_amount: money(input.shippingAmount),
      }),
    });
  }

  /**
   * NOTE: shaped from Tamara's documented `/payments/capture` contract (same
   * order_id + Money pattern), since no sandbox credentials were reachable
   * to verify the refund endpoint directly. Confirm against Tamara's API
   * reference before relying on this in production.
   */
  refundOrder(input: {
    orderId: string;
    amount: number;
    currency: TamaraCurrency;
    comment?: string;
  }): Promise<{ order_id: string; refund_id: string; status: string }> {
    return this.request('/payments/refund', {
      method: 'POST',
      body: JSON.stringify({
        order_id: input.orderId,
        total_amount: { amount: input.amount, currency: input.currency },
        ...(input.comment ? { comment: input.comment.slice(0, 200) } : {}),
      }),
    });
  }

  verifyWebhookToken(token: string | undefined): void {
    const secret = process.env.TAMARA_NOTIFICATION_TOKEN?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'Tamara webhook authentication is not configured',
      );
    }
    if (!token) throw new UnauthorizedException('Missing Tamara webhook token');

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid Tamara webhook token');
    }

    let header: { alg?: string };
    let payload: { exp?: number; nbf?: number };
    try {
      header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      ) as { alg?: string };
      payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as { exp?: number; nbf?: number };
    } catch {
      throw new UnauthorizedException('Invalid Tamara webhook token');
    }
    if (header.alg !== 'HS256') {
      throw new UnauthorizedException('Invalid Tamara webhook algorithm');
    }

    const expected = createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(parts[2], 'base64url');
    } catch {
      throw new UnauthorizedException('Invalid Tamara webhook token');
    }
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new UnauthorizedException('Invalid Tamara webhook signature');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && payload.exp < now) {
      throw new UnauthorizedException('Expired Tamara webhook token');
    }
    if (payload.nbf !== undefined && payload.nbf > now + 30) {
      throw new UnauthorizedException('Tamara webhook token is not active');
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = process.env.TAMARA_API_TOKEN?.trim();
    if (!token) {
      throw new ServiceUnavailableException(
        'Tamara is not configured. Set TAMARA_API_TOKEN on the API.',
      );
    }
    const baseUrl = (
      process.env.TAMARA_API_URL || 'https://api-sandbox.tamara.co'
    ).replace(/\/$/, '');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadGatewayException('Tamara is temporarily unavailable');
    }

    const data = (await response.json().catch(() => null)) as T | {
      message?: string;
    } | null;
    if (!response.ok) {
      const message =
        data && typeof data === 'object' && 'message' in data
          ? data.message
          : undefined;
      throw new BadGatewayException(
        message || `Tamara request failed (${response.status})`,
      );
    }
    return data as T;
  }
}
