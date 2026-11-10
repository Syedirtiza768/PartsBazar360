import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { CartService } from './cart.service';

class AddCartItemDto {
  @IsUUID()
  offerId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsUUID()
  vehicleConfigId?: string | null;
}

class CartLineVehicleDto {
  @IsOptional()
  @IsUUID()
  vehicleConfigId?: string | null;
}

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(
    @Query('userId') userId?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    const cart = await this.cartService.getOrCreateCart(userId, sessionId);
    return this.cartService.getBuyerCart(cart.id);
  }

  @Post(':cartId/items')
  async addItem(@Param('cartId') cartId: string, @Body() body: AddCartItemDto) {
    await this.cartService.addItem(
      cartId,
      body.offerId,
      body.quantity,
      body.vehicleConfigId,
    );
    return this.cartService.getBuyerCart(cartId);
  }

  @Patch(':cartId/items/:itemId')
  async updateItem(
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
    @Body() body: { quantity: number },
  ) {
    await this.cartService.updateItemQuantity(cartId, itemId, body.quantity);
    return this.cartService.getBuyerCart(cartId);
  }

  @Patch(':cartId/items/:itemId/vehicle')
  async setIntendedVehicle(
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
    @Body() body: CartLineVehicleDto,
  ) {
    await this.cartService.setIntendedVehicle(
      cartId,
      itemId,
      body.vehicleConfigId ?? null,
    );
    return this.cartService.getBuyerCart(cartId);
  }

  @Delete(':cartId/items/:itemId')
  async removeItem(
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
  ) {
    await this.cartService.removeItem(cartId, itemId);
    return this.cartService.getBuyerCart(cartId);
  }
}
