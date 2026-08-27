import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateDiscountCouponDto,
  UpdateDiscountCouponDto,
} from './discount-coupon.dto';

function normalizeCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!code) throw new BadRequestException('Coupon code is required');
  return code;
}

function normalizePercent(value: number) {
  if (!Number.isFinite(value) || value < 0.01 || value > 100) {
    throw new BadRequestException(
      'discountPercent must be between 0.01 and 100',
    );
  }
  return Math.round(value * 100) / 100;
}

function normalizeDate(
  value: string | null | undefined,
  field: 'startsAt' | 'endsAt',
) {
  if (value === undefined) return undefined;
  if (value === null || !value.trim()) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid date`);
  }
  return date;
}

function validateDateWindow(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
) {
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new BadRequestException('startsAt must be before endsAt');
  }
}

function auditValue(coupon: {
  code: string;
  discountPercent: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}) {
  return {
    code: coupon.code,
    discountPercent: coupon.discountPercent,
    active: coupon.active,
    startsAt: coupon.startsAt?.toISOString() ?? null,
    endsAt: coupon.endsAt?.toISOString() ?? null,
  };
}

@Injectable()
export class DiscountCouponService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const coupons = await this.prisma.discountCoupon.findMany({
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
      include: { _count: { select: { orders: true } } },
    });

    return coupons.map(({ _count, ...coupon }) => ({
      ...coupon,
      orderCount: _count.orders,
    }));
  }

  async create(input: CreateDiscountCouponDto, actorId?: string) {
    const code = normalizeCode(input.code);
    const discountPercent = normalizePercent(input.discountPercent);
    const startsAt = normalizeDate(input.startsAt, 'startsAt') ?? null;
    const endsAt = normalizeDate(input.endsAt, 'endsAt') ?? null;
    validateDateWindow(startsAt, endsAt);

    let coupon;
    try {
      coupon = await this.prisma.discountCoupon.create({
        data: {
          code,
          discountPercent,
          active: input.active ?? true,
          startsAt,
          endsAt,
        },
      });
    } catch (error) {
      this.throwDuplicateCode(error);
      throw error;
    }

    await this.audit.record({
      action: 'COUPON_CREATED',
      entityType: 'DiscountCoupon',
      entityId: coupon.id,
      actorId,
      normalizedValue: auditValue(coupon),
    });
    return coupon;
  }

  async update(id: string, input: UpdateDiscountCouponDto, actorId?: string) {
    const existing = await this.get(id);
    const code =
      input.code === undefined ? existing.code : normalizeCode(input.code);
    const discountPercent =
      input.discountPercent === undefined
        ? existing.discountPercent
        : normalizePercent(input.discountPercent);
    const active = input.active === undefined ? existing.active : input.active;
    const startsAt =
      input.startsAt === undefined
        ? existing.startsAt
        : normalizeDate(input.startsAt, 'startsAt');
    const endsAt =
      input.endsAt === undefined
        ? existing.endsAt
        : normalizeDate(input.endsAt, 'endsAt');
    validateDateWindow(startsAt, endsAt);

    let coupon;
    try {
      coupon = await this.prisma.discountCoupon.update({
        where: { id },
        data: { code, discountPercent, active, startsAt, endsAt },
      });
    } catch (error) {
      this.throwDuplicateCode(error);
      throw error;
    }

    await this.audit.record({
      action: 'COUPON_UPDATED',
      entityType: 'DiscountCoupon',
      entityId: coupon.id,
      actorId,
      originalValue: auditValue(existing),
      normalizedValue: auditValue(coupon),
    });
    return coupon;
  }

  private async get(id: string) {
    const coupon = await this.prisma.discountCoupon.findUnique({
      where: { id },
    });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  private throwDuplicateCode(error: unknown): void {
    if ((error as { code?: string })?.code === 'P2002') {
      throw new ConflictException('A coupon with this code already exists');
    }
  }
}
