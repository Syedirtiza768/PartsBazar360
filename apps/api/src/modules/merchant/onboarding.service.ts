import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

export interface SellerProfileInput {
  accountType?: string;
  legalName?: string;
  tradingName?: string;
  registrationNumber?: string;
  taxId?: string;
  website?: string;
  phone?: string;
  supportEmail?: string;
  country?: string;
  address?: Record<string, unknown> | null;
  fulfillmentSlaHours?: number;
  returnWindowDays?: number;
  acceptsReturns?: boolean;
  warrantyDays?: number;
  supportedCategories?: string[];
  supportedConditions?: string[];
  shippingRegions?: string[];
  freightCapable?: boolean;
}

@Injectable()
export class SellerOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSellerOnboarding(sellerId: string) {
    if (!sellerId) throw new BadRequestException('sellerId is required');
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: {
        profile: true,
        agreementAcceptances: { orderBy: { acceptedAt: 'desc' } },
        pricingAssignments: {
          where: { status: 'ACTIVE' },
          include: { pricingPolicy: true },
          orderBy: { createdAt: 'desc' },
        },
        warehouses: true,
      },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    return seller;
  }

  async saveProfile(sellerId: string, body: SellerProfileInput) {
    await this.assertSeller(sellerId);
    const mutable = this.profileData(body);
    await this.prisma.sellerProfile.upsert({
      where: { sellerId },
      update: mutable as Prisma.SellerProfileUpdateInput,
      create: { sellerId, ...mutable } as Prisma.SellerProfileUncheckedCreateInput,
    });
    return this.getSellerOnboarding(sellerId);
  }

  async submit(
    sellerId: string,
    body: { acceptedByEmail: string; agreementVersion?: string },
  ) {
    const seller = await this.getSellerOnboarding(sellerId);
    if (!['DRAFT', 'NEEDS_INFORMATION'].includes(seller.onboardingStatus)) {
      throw new BadRequestException(`Seller cannot submit from ${seller.onboardingStatus}`);
    }

    const profile = seller.profile;
    const missing = [
      !profile?.legalName && 'legalName',
      !profile?.country && 'country',
      !profile?.phone && 'phone',
      !profile?.supportEmail && 'supportEmail',
    ].filter(Boolean);
    if (missing.length) throw new BadRequestException(`Missing required fields: ${missing.join(', ')}`);
    if (!body.acceptedByEmail?.trim()) throw new BadRequestException('acceptedByEmail is required');

    const agreementVersion = body.agreementVersion || '2026-07';
    await this.prisma.$transaction([
      this.prisma.sellerAgreementAcceptance.upsert({
        where: {
          sellerId_agreementType_agreementVersion: {
            sellerId,
            agreementType: 'MARKETPLACE_SELLER_TERMS',
            agreementVersion,
          },
        },
        update: { acceptedByEmail: body.acceptedByEmail, acceptedAt: new Date() },
        create: {
          sellerId,
          agreementType: 'MARKETPLACE_SELLER_TERMS',
          agreementVersion,
          acceptedByEmail: body.acceptedByEmail,
        },
      }),
      this.prisma.sellerProfile.update({ where: { sellerId }, data: { submittedAt: new Date() } }),
      this.prisma.seller.update({
        where: { id: sellerId },
        data: { onboardingStatus: 'SUBMITTED', onboardingNotes: null },
      }),
    ]);

    return this.getSellerOnboarding(sellerId);
  }

  private async assertSeller(sellerId: string) {
    if (!sellerId) throw new BadRequestException('sellerId is required');
    const seller = await this.prisma.seller.findUnique({ where: { id: sellerId }, select: { id: true } });
    if (!seller) throw new NotFoundException('Seller not found');
  }

  private profileData(body: SellerProfileInput) {
    const number = (value: number | undefined, fallback: number) => (
      value === undefined ? undefined : Math.max(fallback, Math.floor(value))
    );
    return {
      accountType: body.accountType,
      legalName: body.legalName?.trim() || undefined,
      tradingName: body.tradingName?.trim() || undefined,
      registrationNumber: body.registrationNumber?.trim() || undefined,
      taxId: body.taxId?.trim() || undefined,
      website: body.website?.trim() || undefined,
      phone: body.phone?.trim() || undefined,
      supportEmail: body.supportEmail?.trim() || undefined,
      country: body.country?.trim() || undefined,
      address: body.address === null ? Prisma.JsonNull : body.address as Prisma.InputJsonValue | undefined,
      fulfillmentSlaHours: number(body.fulfillmentSlaHours, 1),
      returnWindowDays: number(body.returnWindowDays, 0),
      acceptsReturns: body.acceptsReturns,
      warrantyDays: number(body.warrantyDays, 0),
      supportedCategories: body.supportedCategories,
      supportedConditions: body.supportedConditions,
      shippingRegions: body.shippingRegions,
      freightCapable: body.freightCapable,
    };
  }
}
