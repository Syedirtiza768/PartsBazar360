import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { CartService } from './cart.service';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(@Query('userId') userId?: string, @Query('sessionId') sessionId?: string) {
    return this.cartService.getOrCreateCart(userId, sessionId);
  }

  @Post(':cartId/items')
  async addItem(
    @Param('cartId') cartId: string,
    @Body() body: { offerId: string; quantity: number }
  ) {
    return this.cartService.addItem(cartId, body.offerId, body.quantity);
  }

  @Patch(':cartId/items/:itemId')
  async updateItem(
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
    @Body() body: { quantity: number },
  ) {
    return this.cartService.updateItemQuantity(cartId, itemId, body.quantity);
  }

  @Delete(':cartId/items/:itemId')
  async removeItem(@Param('cartId') cartId: string, @Param('itemId') itemId: string) {
    return this.cartService.removeItem(cartId, itemId);
  }
}
