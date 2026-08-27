import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DiscountCouponService } from './discount-coupon.service';

describe('DiscountCouponService', () => {
  const existing = {
    id: 'coupon-1',
    code: 'SAVE20',
    discountPercent: 20,
    active: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  function buildService() {
    const prisma = {
      discountCoupon: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    return {
      service: new DiscountCouponService(prisma, audit),
      prisma,
      audit,
    };
  }

  it('normalizes a new coupon and records its creator', async () => {
    const { service, prisma, audit } = buildService();
    prisma.discountCoupon.create.mockResolvedValue({
      ...existing,
      code: 'WELCOME20',
    });

    const result = await service.create(
      { code: ' welcome20 ', discountPercent: 20 },
      'admin-1',
    );

    expect(prisma.discountCoupon.create).toHaveBeenCalledWith({
      data: {
        code: 'WELCOME20',
        discountPercent: 20,
        active: true,
        startsAt: null,
        endsAt: null,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COUPON_CREATED',
        entityId: 'coupon-1',
        actorId: 'admin-1',
      }),
    );
    expect(result.code).toBe('WELCOME20');
  });

  it('rejects an invalid date window before writing', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.create(
        {
          code: 'FLASH20',
          discountPercent: 20,
          startsAt: '2026-09-02T00:00:00.000Z',
          endsAt: '2026-09-01T00:00:00.000Z',
        },
        'admin-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.discountCoupon.create).not.toHaveBeenCalled();
  });

  it('updates only the requested fields and records the before/after values', async () => {
    const { service, prisma, audit } = buildService();
    prisma.discountCoupon.findUnique.mockResolvedValue(existing);
    prisma.discountCoupon.update.mockResolvedValue({
      ...existing,
      active: false,
      discountPercent: 15,
    });

    await service.update(
      'coupon-1',
      { discountPercent: 15, active: false },
      'admin-1',
    );

    expect(prisma.discountCoupon.update).toHaveBeenCalledWith({
      where: { id: 'coupon-1' },
      data: {
        code: 'SAVE20',
        discountPercent: 15,
        active: false,
        startsAt: null,
        endsAt: null,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COUPON_UPDATED',
        originalValue: expect.objectContaining({ code: 'SAVE20' }),
        normalizedValue: expect.objectContaining({
          discountPercent: 15,
          active: false,
        }),
      }),
    );
  });

  it('maps duplicate coupon codes to a conflict response', async () => {
    const { service, prisma } = buildService();
    prisma.discountCoupon.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.create({ code: 'SAVE20', discountPercent: 20 }, 'admin-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('returns not found for an unknown coupon', async () => {
    const { service, prisma } = buildService();
    prisma.discountCoupon.findUnique.mockResolvedValue(null);

    await expect(service.update('missing', {}, 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
