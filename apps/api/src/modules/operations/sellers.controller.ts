import { BadRequestException, Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

const ONBOARDING_STATES = [
  'DRAFT',
  'SUBMITTED',
  'IDENTITY_REVIEW',
  'COMMERCIAL_REVIEW',
  'CATALOG_REVIEW',
  'READY',
  'ACTIVE',
  'NEEDS_INFORMATION',
  'REJECTED',
  'SUSPENDED',
  'OFFBOARDING',
];

@Controller('operations/sellers')
export class SellerOperationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('onboarding')
  list() {
    return this.prisma.seller.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        profile: true,
        agreementAcceptances: { orderBy: { acceptedAt: 'desc' } },
        pricingAssignments: {
          where: { status: 'ACTIVE' },
          include: { pricingPolicy: true },
        },
        warehouses: true,
        _count: { select: { offers: true, sellerOrders: true } },
      },
    });
  }

  @Patch(':sellerId/onboarding')
  async updateStatus(
    @Param('sellerId') sellerId: string,
    @Body() body: {
      status: string;
      notes?: string;
      complianceStatus?: string;
      payoutStatus?: string;
    },
  ) {
    if (!ONBOARDING_STATES.includes(body.status)) {
      throw new BadRequestException(`Unsupported onboarding status: ${body.status}`);
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: { profile: true, pricingAssignments: { where: { status: 'ACTIVE' } } },
    });
    if (!seller) throw new BadRequestException('Seller not found');

    const complianceStatus = body.complianceStatus || seller.profile?.complianceStatus;
    const payoutStatus = body.payoutStatus || seller.profile?.payoutStatus;
    if (body.status === 'ACTIVE') {
      if (complianceStatus !== 'VERIFIED') throw new BadRequestException('Compliance must be VERIFIED before activation');
      if (payoutStatus !== 'VERIFIED') throw new BadRequestException('Payout account must be VERIFIED before activation');
      if (seller.pricingAssignments.length === 0) throw new BadRequestException('Assign an active pricing policy before activation');
    }

    await this.prisma.$transaction(async (tx) => {
      if (seller.profile && (body.complianceStatus || body.payoutStatus || body.status === 'ACTIVE')) {
        await tx.sellerProfile.update({
          where: { sellerId },
          data: {
            complianceStatus: body.complianceStatus,
            payoutStatus: body.payoutStatus,
            approvedAt: body.status === 'ACTIVE' ? new Date() : undefined,
          },
        });
      }
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          onboardingStatus: body.status,
          onboardingNotes: body.notes,
          activatedAt: body.status === 'ACTIVE' ? new Date() : undefined,
        },
      });
    });

    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: { profile: true, pricingAssignments: { include: { pricingPolicy: true } } },
    });
  }
}

