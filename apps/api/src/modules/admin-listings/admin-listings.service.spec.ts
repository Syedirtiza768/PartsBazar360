import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminListingsService } from './admin-listings.service';
import { detectImageExtension } from './listing-image-store';

function listingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    status: 'ACTIVE',
    price: 100,
    sellerBasePrice: 70,
    currency: 'USD',
    shippingCost: null,
    condition: 'NEW',
    partType: 'AFTERMARKET',
    sellerSku: 'SKU-1',
    sourceTag: null,
    sellerTitle: null,
    canonicalPartId: 'part-1',
    updatedAt: new Date('2026-11-13T00:00:00Z'),
    seller: { id: 'seller-1', name: 'Seller' },
    inventory: [{ quantity: 2, status: 'AVAILABLE' }],
    canonicalPart: {
      id: 'part-1',
      slug: 'part-1-slug',
      title: 'Brake pad',
      brand: 'Bosch',
      manufacturerPartNumber: 'BP1',
      category: 'Brakes',
      imageUrls: [],
      weight: 1,
    },
    ...overrides,
  };
}

function setup() {
  const prisma: any = {
    sellerOffer: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    canonicalPart: { findUnique: jest.fn().mockResolvedValue(null) },
    seller: { findUnique: jest.fn() },
    brandMaster: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const search = { indexPart: jest.fn() };
  const outbox = { enqueue: jest.fn() };
  const cache = { revalidatePart: jest.fn().mockResolvedValue(undefined) };
  const slugs = { ensureSlug: jest.fn().mockResolvedValue(null) };
  const service = new AdminListingsService(
    prisma,
    audit as any,
    search as any,
    outbox as any,
    cache as any,
    slugs as any,
  );
  return { service, prisma, audit, outbox, cache };
}

describe('AdminListingsService.update', () => {
  it('sets the buyer price and recomputes the marketplace share', async () => {
    const { service, prisma, audit, outbox, cache } = setup();
    prisma.sellerOffer.findUnique.mockResolvedValue(listingRecord());
    prisma.sellerOffer.update.mockResolvedValue(listingRecord({ price: 120 }));

    const result = await service.update('offer-1', { price: 120 }, 'admin-1');

    expect(prisma.sellerOffer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ price: 120, marketplaceFee: 50 }),
      }),
    );
    expect(result.price).toBe(120);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LISTING_UPDATED',
        actorId: 'admin-1',
      }),
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      'part-1',
      'UPSERT',
      'ADMIN_LISTING_UPDATE',
    );
    expect(cache.revalidatePart).toHaveBeenCalledWith('part-1');
  });

  it('can clear a shipping override back to the calculated quote', async () => {
    const { service, prisma } = setup();
    prisma.sellerOffer.findUnique.mockResolvedValue(
      listingRecord({ shippingCost: 25 }),
    );
    prisma.sellerOffer.update.mockResolvedValue(listingRecord());

    await service.update('offer-1', { shippingCost: null });

    expect(prisma.sellerOffer.update.mock.calls[0][0].data).toEqual({
      shippingCost: null,
    });
  });

  it('rejects an empty update and unknown listings', async () => {
    const { service, prisma } = setup();
    prisma.sellerOffer.findUnique.mockResolvedValueOnce(listingRecord());
    await expect(service.update('offer-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.sellerOffer.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.update('missing', { price: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminListingsService.create', () => {
  it('creates part, offer and stock for the seller, then indexes it', async () => {
    const { service, prisma, audit, outbox } = setup();
    prisma.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      name: 'Seller',
      warehouses: [{ id: 'wh-1' }],
    });
    const tx = {
      canonicalPart: { create: jest.fn().mockResolvedValue({ id: 'part-9' }) },
      catalogPartNumber: { create: jest.fn() },
      warehouse: { create: jest.fn() },
      sellerOffer: {
        create: jest.fn().mockResolvedValue({ id: 'offer-9', shippingCost: 0 }),
      },
      inventory: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    prisma.sellerOffer.findUniqueOrThrow.mockResolvedValue(
      listingRecord({ id: 'offer-9', canonicalPartId: 'part-9' }),
    );

    await service.create(
      {
        sellerId: 'seller-1',
        title: '  Front   brake pads ',
        manufacturerPartNumber: 'bp-123',
        condition: 'NEW',
        partType: 'GENUINE_OEM',
        price: 49.999,
        currency: 'AED',
        shippingCost: 0,
        quantity: 3,
        imageUrls: [
          '/api/listing-images/00000000-0000-0000-0000-000000000000.jpg',
        ],
      },
      'admin-1',
    );

    expect(tx.canonicalPart.create.mock.calls[0][0].data).toMatchObject({
      title: 'Front brake pads',
      partSource: 'OEM',
      partType: 'GENUINE_OEM',
      manufacturerPartNumber: 'bp-123',
    });
    expect(tx.catalogPartNumber.create.mock.calls[0][0].data).toMatchObject({
      normalizedNumber: 'BP123',
      numberType: 'BRAND_MPN',
    });
    expect(tx.sellerOffer.create.mock.calls[0][0].data).toMatchObject({
      sellerId: 'seller-1',
      price: 50,
      currency: 'AED',
      shippingCost: 0,
      status: 'ACTIVE',
    });
    expect(tx.inventory.create.mock.calls[0][0].data).toMatchObject({
      warehouseId: 'wh-1',
      quantity: 3,
      status: 'AVAILABLE',
    });
    expect(tx.warehouse.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LISTING_CREATED' }),
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      'part-9',
      'UPSERT',
      'ADMIN_LISTING_CREATE',
    );
  });

  it('rejects an unknown seller', async () => {
    const { service, prisma } = setup();
    prisma.seller.findUnique.mockResolvedValue(null);
    await expect(
      service.create({
        sellerId: 'nope',
        title: 'x',
        condition: 'NEW',
        partType: 'AFTERMARKET',
        price: 1,
        currency: 'USD',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('detectImageExtension', () => {
  it('identifies images by magic bytes, not by name', () => {
    const pad = Buffer.alloc(12);
    expect(
      detectImageExtension(
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), pad]),
      ),
    ).toBe('jpg');
    expect(
      detectImageExtension(
        Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), pad]),
      ),
    ).toBe('png');
    expect(
      detectImageExtension(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'ascii')),
    ).toBe('webp');
    expect(detectImageExtension(Buffer.from('<svg></svg>xxxxxx'))).toBeNull();
  });
});
