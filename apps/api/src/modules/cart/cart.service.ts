import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
                canonicalPart: true
              }
            }
          }
        }
      }
    });

    if (!cart) {
      throw new NotFoundException(`Cart ${cartId} not found`);
    }

    return cart;
  }

  async getOrCreateCart(userId?: string, sessionId?: string) {
    if (!userId && !sessionId) {
      throw new BadRequestException('Must provide userId or sessionId');
    }

    const where = userId ? { userId } : { sessionId };
    let cart = await this.prisma.cart.findFirst({ where: { ...where, status: 'ACTIVE' } });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: {
          userId,
          sessionId,
        }
      });
    }

    return this.getCart(cart.id);
  }

  async addItem(cartId: string, offerId: string, quantity: number) {
    // 1. Validate offer and stock
    const offer = await this.prisma.sellerOffer.findUnique({
      where: { id: offerId },
      include: { inventory: true }
    });

    if (!offer || offer.status !== 'ACTIVE') {
      throw new BadRequestException('Offer is not available');
    }

    const totalStock = offer.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
    if (totalStock < quantity) {
      throw new BadRequestException(`Insufficient stock. Only ${totalStock} available.`);
    }

    // 2. Add or update item in cart
    const existingItem = await this.prisma.cartItem.findFirst({
      where: { cartId, sellerOfferId: offerId }
    });

    if (existingItem) {
      await this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity }
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId,
          sellerOfferId: offerId,
          quantity,
        }
      });
    }

    return this.getCart(cartId);
  }

  async updateItemQuantity(cartId: string, itemId: string, quantity: number) {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
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
    const totalStock = offer?.inventory.reduce((sum, inv) => sum + inv.quantity, 0) ?? 0;
    if (totalStock < quantity) {
      throw new BadRequestException(`Insufficient stock. Only ${totalStock} available.`);
    }

    await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    return this.getCart(cartId);
  }

  async removeItem(cartId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCart(cartId);
  }
}
