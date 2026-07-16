import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PRICING_MODES, PricingService } from '../pricing/pricing.service';

@Controller('operations/pricing-policies')
export class PricingOperationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  @Get()
  list() {
    return this.prisma.pricingPolicy.findMany({
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      include: { _count: { select: { assignments: true, pricedOffers: true } } },
    });
  }

  @Post()
  async create(@Body() body: {
    code: string;
    name: string;
    mode: string;
    percentRate?: number;
    fixedFee?: number;
    currency?: string;
    category?: string;
    minimumPrice?: number;
    maximumFee?: number;
    priority?: number;
    status?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    terms?: Record<string, unknown>;
    createdBy?: string;
  }) {
    const code = body.code?.trim().toUpperCase();
    if (!code || !body.name?.trim()) throw new BadRequestException('code and name are required');
    if (!PRICING_MODES.includes(body.mode as any)) throw new BadRequestException(`Unsupported pricing mode: ${body.mode}`);
    const percentRate = Number(body.percentRate || 0);
    if (percentRate < 0 || percentRate >= 1) throw new BadRequestException('percentRate must be between 0 and 0.9999');

    const latest = await this.prisma.pricingPolicy.findFirst({ where: { code }, orderBy: { version: 'desc' } });
    return this.prisma.pricingPolicy.create({
      data: {
        code,
        name: body.name.trim(),
        version: (latest?.version || 0) + 1,
        mode: body.mode,
        percentRate,
        fixedFee: Number(body.fixedFee || 0),
        currency: body.currency || 'USD',
        category: body.category?.trim() || null,
        minimumPrice: body.minimumPrice === undefined ? null : Number(body.minimumPrice),
        maximumFee: body.maximumFee === undefined ? null : Number(body.maximumFee),
        priority: Number(body.priority || 0),
        status: body.status || 'DRAFT',
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
        terms: body.terms as any,
        createdBy: body.createdBy,
      },
    });
  }

  @Patch(':policyId')
  async update(
    @Param('policyId') policyId: string,
    @Body() body: { status?: string; approvedBy?: string; effectiveTo?: string | null },
  ) {
    if (body.status && !['DRAFT', 'ACTIVE', 'RETIRED'].includes(body.status)) {
      throw new BadRequestException('status must be DRAFT, ACTIVE, or RETIRED');
    }
    return this.prisma.pricingPolicy.update({
      where: { id: policyId },
      data: {
        status: body.status,
        approvedBy: body.approvedBy,
        effectiveTo: body.effectiveTo === null ? null : body.effectiveTo ? new Date(body.effectiveTo) : undefined,
      },
    });
  }

  @Post('assign')
  async assign(@Body() body: { sellerId: string; pricingPolicyId: string; category?: string }) {
    const policy = await this.prisma.pricingPolicy.findUnique({ where: { id: body.pricingPolicyId } });
    if (!policy || policy.status !== 'ACTIVE') throw new BadRequestException('Pricing policy must be ACTIVE');
    const seller = await this.prisma.seller.findUnique({ where: { id: body.sellerId } });
    if (!seller) throw new BadRequestException('Seller not found');

    const category = body.category?.trim() || null;
    await this.prisma.$transaction(async (tx) => {
      await tx.sellerPricingAssignment.updateMany({
        where: { sellerId: body.sellerId, category, status: 'ACTIVE' },
        data: { status: 'RETIRED', effectiveTo: new Date() },
      });
      await tx.sellerPricingAssignment.create({
        data: { sellerId: body.sellerId, pricingPolicyId: body.pricingPolicyId, category },
      });
    });

    const repricedOffers = await this.pricing.repriceSeller(body.sellerId);
    return { assignmentCreated: true, repricedOffers };
  }
}
