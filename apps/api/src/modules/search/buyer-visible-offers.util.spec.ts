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
    expect(item?.offers?.[0].sellerName).toBe('Superior Auto Parts');
    expect(item?.minPrice).toBe(9);
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
      const unknownBlk = { sellerId: 'some-new-id', sellerName: 'Blackline Auto Parts' };
      const unknownSal = { sellerId: 'other-new-id', seller: { name: 'Salvage Auto Parts' } };
      const sup = { sellerId: 'x', sellerName: 'Superior Auto Parts' };
      expect(applySuperiorPriority([unknownBlk, unknownSal, sup])).toEqual([sup]);
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
