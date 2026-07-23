/**
 * Unit checks for buyer-visible offer sanitization.
 */
import {
  isBuyerVisibleIndexedOffer,
  sanitizeSearchItem,
  sanitizeSearchItems,
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
    const item = sanitizeSearchItem({
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
    expect(item?.offers[0].sellerName).toBe('Superior Auto Parts');
    expect(item?.minPrice).toBe(9);
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
