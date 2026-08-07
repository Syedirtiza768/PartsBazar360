import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { BuyerCacheService } from '../search/buyer-cache.service';
import { OpenSearchService } from '../search/opensearch.service';
import { SearchOutboxService } from '../search/index/search-outbox.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SellerId } from '../auth/seller-id.decorator';

@Controller('merchant/inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly buyerCache: BuyerCacheService,
    private readonly search: OpenSearchService,
    private readonly searchOutbox: SearchOutboxService,
  ) {}

  @Get()
  async getInventory(
    @SellerId() sellerId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, page ? parseInt(page, 10) || 1 : 1);
    const take = Math.min(
      Math.max(1, limit ? parseInt(limit, 10) || 50 : 50),
      200,
    );
    const skip = (pageNum - 1) * take;

    const where = { sellerId };
    const [items, total] = await Promise.all([
      this.prisma.sellerOffer.findMany({
        where,
        include: {
          canonicalPart: {
            select: {
              id: true,
              title: true,
              imageUrls: true,
              brand: true,
              manufacturerPartNumber: true,
            },
          },
          inventory: {
            select: { quantity: true, status: true, warehouseId: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.sellerOffer.count({ where }),
    ]);

    return { items, total, page: pageNum, limit: take };
  }

  @Patch(':offerId')
  async updateOffer(
    @Param('offerId') offerId: string,
    @SellerId() sellerId: string,
    @Body() body: { price?: number; status?: string },
  ) {
    const offer = await this.prisma.sellerOffer.findFirst({
      where: { id: offerId, sellerId },
    });

    if (!offer) throw new NotFoundException('Offer not found');

    if (body.status !== undefined) {
      await this.prisma.sellerOffer.update({
        where: { id: offerId },
        data: { status: body.status },
      });

      // A status flip (e.g. a seller pausing a listing) previously never
      // reached OpenSearch — only a Next.js cache revalidation ran below —
      // so the doc stayed searchable/buyable long after the seller turned
      // it off. Sync both the durable outbox (feeds the newer index path)
      // and the live legacy index directly, matching the pattern used in
      // merchant/uploads.service.ts.
      await this.searchOutbox.enqueue(
        offer.canonicalPartId,
        'UPSERT',
        'MERCHANT_INVENTORY_STATUS_UPDATE',
      );
      const part = await this.prisma.canonicalPart.findUnique({
        where: { id: offer.canonicalPartId },
        include: {
          offers: { include: { seller: true } },
          partNumbers: true,
        },
      });
      if (part) await this.search.indexPart(part);
    }

    let result;
    if (body.price !== undefined) {
      result = await this.pricing.repriceOffer(offerId, Number(body.price));
    } else {
      result = await this.prisma.sellerOffer.findUnique({
        where: { id: offerId },
        include: { canonicalPart: true, inventory: true, pricingPolicy: true },
      });
    }

    void this.buyerCache.revalidatePart(offer.canonicalPartId);
    return result;
  }
}
