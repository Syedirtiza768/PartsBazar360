/**
 * Unit checks for buyer-visible offer sanitization.
 */
import {
  applySuperiorPriority,
  isBuyerVisibleIndexedOffer,
  sanitizeSearchItem,
  sanitizeSearchItems,
  type SearchItemLike,
} from './buyer-visible-offers.util';

describe('buyer-visible-offers', () => {
  it('hides legacy FEBEST Inventory Supplier offers', () => {
    expect(
      isBuyerVisibleIndexedOffer({
        sellerId: 'seed-febest-inventory-supplier',
        sellerName: 'FEBEST Inventory Supplier',
        price: 10,
      }),
    ).toBe(false);
  });

  it('keeps Superior Auto Parts offers', () => {
    expect(
      isBuyerVisibleIndexedOffer({
        sellerId: 'seller-superior-auto-parts',
        sellerName: 'Superior Auto Parts',
        price: 10,
      }),
    ).toBe(true);
  });

  it('sanitizes dual-offer FEBEST docs to Superior only', () => {
    const item = sanitizeSearchItem<SearchItemLike>({
      id: 'p1',
      offers: [
        {
          sellerId: 'seed-febest-inventory-supplier',
          sellerName: 'FEBEST Inventory Supplier',
          price: 8,
        },
        {
          sellerId: 'seller-superior-auto-parts',
          sellerName: 'Superior Auto Parts',
          price: 9,
        },
      ],
    });
    expect(item?.offers).toHaveLength(1);
    expect(item?.offers?.[0]).not.toHaveProperty('sellerName');
    expect(item?.offers?.[0]).not.toHaveProperty('sellerId');
    expect(item?.minPrice).toBe(9);
  });

  it('uses an explicit public projection and strips supplier identity and contact data', () => {
    const item = sanitizeSearchItem<SearchItemLike>({
      id: 'p3',
      title: 'Superior Auto Parts genuine brake disc',
      description: 'Call +971 50 123 4567 or sales@example.test. Source YNTD.',
      brand: 'Brembo',
      sellerIds: ['supplier-1'],
      sellerNames: ['Superior Auto Parts'],
      listingUrl: 'https://seller.example/listing/1',
      partNumbers: [{ numberType: 'SELLER_SKU', displayNumber: 'PRIVATE-1' }],
      internalMemo: 'must not be projected',
      fitmentStatus: 'CONFIRMED',
      fitmentConfidence: 0.98,
      itemSpecifics: {
        sellerSku: 'PRIVATE-1',
        _seo: { source: 'supplier feed' },
        material: 'Aluminum',
      },
      offers: [
        {
          id: 'offer-1',
          sellerId: 'seller-superior-auto-parts',
          sellerName: 'Superior Auto Parts',
          sourceTag: 'YNTD',
          sellerSku: 'PRIVATE-1',
          sellerBasePrice: 20,
          price: 25,
          currency: 'AED',
          condition: 'USED',
        },
      ],
    });

    expect(item).not.toHaveProperty('sellerIds');
    expect(item).not.toHaveProperty('sellerNames');
    expect(item).not.toHaveProperty('listingUrl');
    expect(item).not.toHaveProperty('partNumbers');
    expect(item).not.toHaveProperty('internalMemo');
    expect(item?.title).not.toContain('Superior Auto Parts');
    expect(item?.description).not.toMatch(/\+971|example\.test|YNTD/i);
    expect(item?.fitmentStatus).toBe('LIKELY');
    expect(item?.fitmentConfidence).toBeLessThanOrEqual(0.65);
    expect(item?.itemSpecifics).toEqual({ material: 'Aluminum' });
    expect(item?.offers?.[0]).toEqual({
      id: 'offer-1',
      price: 25,
      currency: 'AED',
      condition: 'USED',
      inStock: true,
      freeShipping: false,
    });
  });

  describe('Superior priority', () => {
    const blk = { sellerId: 'seller-blackline-auto-parts', price: 5 };
    const sal = { sellerId: 'seller-salvage-auto-parts', price: 6 };
    const sup = { sellerId: 'seller-superior-auto-parts', price: 90 };
    const other = { sellerId: 'seller-dynatrade', price: 7 };

    it('suppresses Blackline and Salvage together when Superior is present', () => {
      expect(applySuperiorPriority([blk, sal, sup])).toEqual([sup]);
    });

    it('suppresses either one on its own', () => {
      expect(applySuperiorPriority([blk, sup])).toEqual([sup]);
      expect(applySuperiorPriority([sal, sup])).toEqual([sup]);
    });

    it('leaves them alone when there is no Superior offer', () => {
      expect(applySuperiorPriority([blk, sal])).toEqual([blk, sal]);
    });

    it('does not touch other sellers', () => {
      expect(applySuperiorPriority([other, blk, sup])).toEqual([other, sup]);
    });

    it('suppresses Blackline when it carries a UUID sellerId, not the slug', () => {
      // Production shape: the RealTrack importer created Blackline with a UUID,
      // so an ID-only rule let every Blackline offer through.
      const blkUuid = {
        sellerId: '21924d3c-b345-4dcd-900c-b4bcf92b01c0',
        sellerName: 'Blackline Auto Parts',
        price: 89.99,
      };
      const sup = {
        sellerId: 'seller-superior-auto-parts',
        sellerName: 'Superior Auto Parts',
        price: 406,
      };
      expect(applySuperiorPriority([blkUuid, sup])).toEqual([sup]);
    });

    it('suppresses by seller name even when the id is unrecognised', () => {
      const unknownBlk = {
        sellerId: 'some-new-id',
        sellerName: 'Blackline Auto Parts',
      };
      const unknownSal = {
        sellerId: 'other-new-id',
        seller: { name: 'Salvage Auto Parts' },
      };
      const sup = { sellerId: 'x', sellerName: 'Superior Auto Parts' };
      expect(applySuperiorPriority([unknownBlk, unknownSal, sup])).toEqual([
        sup,
      ]);
    });

    it('wins even when Superior is the more expensive offer', () => {
      const item = sanitizeSearchItem<SearchItemLike>({
        id: 'p2',
        offers: [sal, sup],
      });
      expect(item?.offers).toHaveLength(1);
      expect(item?.minPrice).toBe(90);
    });
  });

  it('drops parts with no buyer-visible offers', () => {
    expect(
      sanitizeSearchItems([
        {
          id: 'ghost',
          offers: [
            {
              sellerId: 'seed-febest-inventory-supplier',
              sellerName: 'FEBEST Inventory Supplier',
              price: 1,
            },
          ],
        },
      ]),
    ).toEqual([]);
  });
});
