import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  async getCart(cartId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            sellerOffer: {
              include: {
                seller: true,
                canonicalPart: true,
                inventory: true,
              },
            },
          },
        },
      },
    });

    if (!cart) {
      throw new NotFoundException(`Cart ${cartId} not found`);
    }

    return cart;
  }

  /** Buyer API projection; private seller, warehouse, and session data stays server-side. */
  async getBuyerCart(cartId: string) {
    const cart = await this.getCart(cartId);
    const shipmentNumbers = new Map(
      [...new Set(cart.items.map((item) => item.sellerOffer.sellerId))]
        .sort((a, b) => a.localeCompare(b))
        .map((sellerId, index) => [sellerId, index + 1] as const),
    );

    return {
      id: cart.id,
      status: cart.status,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
      items: cart.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        intendedVehicleConfigId: item.intendedVehicleConfigId,
        purchaseIntent: item.purchaseIntent,
        sellerOffer: {
          id: item.sellerOffer.id,
          price: item.sellerOffer.price,
          currency: item.sellerOffer.currency,
          condition: item.sellerOffer.condition,
          partSource: item.sellerOffer.partSource,
          partType: item.sellerOffer.partType,
          qualityTier: item.sellerOffer.qualityTier,
          shipmentLabel: `Shipment ${shipmentNumbers.get(item.sellerOffer.sellerId)}`,
          canonicalPart: {
            id: item.sellerOffer.canonicalPart.id,
            slug: item.sellerOffer.canonicalPart.slug,
            title: item.sellerOffer.canonicalPart.title,
            imageUrls: item.sellerOffer.canonicalPart.imageUrls,
            partSource: item.sellerOffer.canonicalPart.partSource,
            partType: item.sellerOffer.canonicalPart.partType,
            oeNumbers: item.sellerOffer.canonicalPart.oeNumbers,
          },
        },
      })),
    };
  }

  async getOrCreateCart(userId?: string, sessionId?: string) {
    if (!userId && !sessionId) {
      throw new BadRequestException('Must provide userId or sessionId');
    }

    const where = userId ? { userId } : { sessionId };
    let cart = await this.prisma.cart.findFirst({
      where: { ...where, status: 'ACTIVE' },
    });

    if (!cart) {
      // Checked-out carts keep history but must release sessionId (unique)
      // or guests cannot open a new ACTIVE cart after checkout.
      if (sessionId) {
        await this.prisma.cart.updateMany({
          where: { sessionId, NOT: { status: 'ACTIVE' } },
          data: { sessionId: null },
        });
      }

      try {
        cart = await this.prisma.cart.create({
          data: {
            userId,
            sessionId,
          },
        });
      } catch (err) {
        // Concurrent create race — return the ACTIVE cart if another request won.
        cart = await this.prisma.cart.findFirst({
          where: { ...where, status: 'ACTIVE' },
        });
        if (!cart) {
          throw err;
        }
      }
    }

    return this.getCart(cart.id);
  }

  async addItem(
    cartId: string,
    offerId: string,
    quantity: number,
    vehicleConfigId?: string | null,
  ) {
    // 1. Validate offer and stock
    const offer = await this.prisma.sellerOffer.findUnique({
      where: { id: offerId },
      include: { inventory: true, seller: true },
    });

    if (
      !offer ||
      offer.status !== 'ACTIVE' ||
      offer.seller.onboardingStatus !== 'ACTIVE'
    ) {
      throw new BadRequestException('Offer is not available');
    }

    const totalStock = offer.inventory.reduce(
      (sum, inv) => sum + inv.quantity,
      0,
    );
    const intentSpecified = vehicleConfigId !== undefined;
    const intendedVehicleConfigId = vehicleConfigId ?? null;
    if (intendedVehicleConfigId) {
      const configuration = await this.prisma.vehicleConfiguration.findUnique({
        where: { id: intendedVehicleConfigId },
        select: { id: true },
      });
      if (!configuration) {
        throw new BadRequestException('Selected vehicle is unavailable');
      }
    }

    // Keep separate cart lines when the buyer intends the same offer for
    // different vehicles; otherwise one line could silently represent two
    // incompatible purchase decisions.
    const existingItems = await this.prisma.cartItem.findMany({
      where: { cartId, sellerOfferId: offerId },
    });
    const existingQuantity = existingItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    if (existingQuantity + quantity > totalStock) {
      throw new BadRequestException(
        `Insufficient stock. Only ${Math.max(0, totalStock - existingQuantity)} more available.`,
      );
    }
    const existingItem = existingItems.find(
      (item) =>
        !intentSpecified ||
        (item.intendedVehicleConfigId ?? null) === intendedVehicleConfigId,
    );

    if (existingItem) {
      await this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId,
          sellerOfferId: offerId,
          quantity,
          intendedVehicleConfigId,
          purchaseIntent: intendedVehicleConfigId
            ? 'VEHICLE_FITMENT'
            : 'UNSPECIFIED',
        },
      });
    }

    return this.getCart(cartId);
  }

  async updateItemQuantity(cartId: string, itemId: string, quantity: number) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    if (quantity <= 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
      return this.getCart(cartId);
    }

    const offer = await this.prisma.sellerOffer.findUnique({
      where: { id: item.sellerOfferId },
      include: { inventory: true },
    });
    const totalStock =
      offer?.inventory.reduce((sum, inv) => sum + inv.quantity, 0) ?? 0;
    if (totalStock < quantity) {
      throw new BadRequestException(
        `Insufficient stock. Only ${totalStock} available.`,
      );
    }

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
    });
    return this.getCart(cartId);
  }

  async setIntendedVehicle(
    cartId: string,
    itemId: string,
    vehicleConfigId: string | null,
  ) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId, cart: { status: 'ACTIVE' } },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Active cart item not found');
    }

    if (vehicleConfigId) {
      const configuration = await this.prisma.vehicleConfiguration.findUnique({
        where: { id: vehicleConfigId },
        select: { id: true },
      });
      if (!configuration) {
        throw new BadRequestException('Selected vehicle is unavailable');
      }
    }

    await this.prisma.$transaction([
      this.prisma.cartItem.update({
        where: { id: itemId },
        data: {
          intendedVehicleConfigId: vehicleConfigId,
          purchaseIntent: vehicleConfigId ? 'VEHICLE_FITMENT' : 'UNSPECIFIED',
        },
      }),
      this.prisma.cart.update({
        where: { id: cartId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return this.getCart(cartId);
  }

  async removeItem(cartId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCart(cartId);
  }
}
