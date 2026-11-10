import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartService } from './cart.service';

describe('CartService per-line vehicle intent', () => {
  it('keeps the same offer on distinct lines for distinct intended vehicles', async () => {
    const prisma = {
      sellerOffer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'offer-1',
          status: 'ACTIVE',
          inventory: [{ quantity: 4 }],
          seller: { onboardingStatus: 'ACTIVE' },
        }),
      },
      vehicleConfiguration: {
        findUnique: jest.fn().mockResolvedValue({ id: 'vehicle-2' }),
      },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'line-1',
            quantity: 1,
            intendedVehicleConfigId: 'vehicle-1',
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 'line-2' }),
        update: jest.fn(),
      },
      cart: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cart-1', items: [] }),
      },
    };
    const service = new CartService(prisma as any);

    await service.addItem('cart-1', 'offer-1', 1, 'vehicle-2');

    expect(prisma.cartItem.create).toHaveBeenCalledWith({
      data: {
        cartId: 'cart-1',
        sellerOfferId: 'offer-1',
        quantity: 1,
        intendedVehicleConfigId: 'vehicle-2',
        purchaseIntent: 'VEHICLE_FITMENT',
      },
    });
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  });

  it('counts quantities across vehicle-specific lines before allowing another add', async () => {
    const prisma = {
      sellerOffer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'offer-1',
          status: 'ACTIVE',
          inventory: [{ quantity: 3 }],
          seller: { onboardingStatus: 'ACTIVE' },
        }),
      },
      vehicleConfiguration: {
        findUnique: jest.fn().mockResolvedValue({ id: 'vehicle-2' }),
      },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'line-1',
            quantity: 3,
            intendedVehicleConfigId: 'vehicle-1',
          },
        ]),
        create: jest.fn(),
        update: jest.fn(),
      },
      cart: { findUnique: jest.fn() },
    };
    const service = new CartService(prisma as any);

    await expect(
      service.addItem('cart-1', 'offer-1', 1, 'vehicle-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('assigns a saved vehicle to one active cart line', async () => {
    const prisma = {
      cartItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 'line-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      vehicleConfiguration: {
        findUnique: jest.fn().mockResolvedValue({ id: 'vehicle-1' }),
      },
      cart: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          id: 'cart-1',
          items: [],
        }),
      },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    const service = new CartService(prisma as any);

    await service.setIntendedVehicle('cart-1', 'line-1', 'vehicle-1');

    expect(prisma.cartItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'line-1', cartId: 'cart-1', cart: { status: 'ACTIVE' } },
      select: { id: true },
    });
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: {
        intendedVehicleConfigId: 'vehicle-1',
        purchaseIntent: 'VEHICLE_FITMENT',
      },
    });
    expect(prisma.cart.update).toHaveBeenCalledWith({
      where: { id: 'cart-1' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('does not allow an item from another or completed cart to be changed', async () => {
    const prisma = {
      cartItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      vehicleConfiguration: { findUnique: jest.fn() },
      cart: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new CartService(prisma as any);

    await expect(
      service.setIntendedVehicle('cart-1', 'foreign-line', 'vehicle-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.vehicleConfiguration.findUnique).not.toHaveBeenCalled();
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
