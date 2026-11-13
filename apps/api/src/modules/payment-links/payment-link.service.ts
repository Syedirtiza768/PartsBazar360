import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { StripeService } from '../checkout/stripe.service';
import type { CreatePaymentLinkDto } from './payment-link.dto';

@Injectable()
export class PaymentLinkService {
  constructor(
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreatePaymentLinkDto, actorId: string) {
    const name = input.name.trim();
    const description = input.description?.trim() || undefined;
    const reference = input.reference?.trim() || undefined;
    const amount = Math.round(input.amount * 100) / 100;
    const currency = input.currency.toUpperCase() as 'AED' | 'USD';
    const paymentLink = await this.stripe.createPaymentLink({
      name,
      description,
      amount,
      currency,
      reference,
    });

    await this.audit.record({
      action: 'STRIPE_PAYMENT_LINK_CREATED',
      entityType: 'StripePaymentLink',
      entityId: paymentLink.id,
      actorId,
      normalizedValue: {
        name,
        description: description ?? null,
        amount,
        currency,
        reference: reference ?? null,
        url: paymentLink.url,
        livemode: paymentLink.livemode,
        completedSessionLimit: 1,
      },
    });

    return {
      id: paymentLink.id,
      url: paymentLink.url,
      name,
      amount,
      currency,
      reference: reference ?? null,
      livemode: paymentLink.livemode,
    };
  }
}
