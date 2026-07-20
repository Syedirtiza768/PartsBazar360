import {
  findMarketplaceSellerByStoreId,
  resolveRealTrackSyncTarget,
  MARKETPLACE_SELLERS,
  SALVAGE_STORE_ID,
  BLACKLINE_STORE_ID,
} from '../seed/marketplace-sellers.config';

describe('marketplace store isolation', () => {
  it('maps Salvage and Blackline to distinct RealTrack store IDs', () => {
    expect(MARKETPLACE_SELLERS.salvage.storeId).toBe(SALVAGE_STORE_ID);
    expect(MARKETPLACE_SELLERS.blackline.storeId).toBe(BLACKLINE_STORE_ID);
    expect(MARKETPLACE_SELLERS.salvage.storeSlug).toBe('salvagea');
    expect(MARKETPLACE_SELLERS.blackline.storeSlug).toBe('blacklineusedautoparts');
    expect(SALVAGE_STORE_ID).not.toBe(BLACKLINE_STORE_ID);
  });

  it('resolves sync targets without cross-assigning stores', () => {
    const salvage = resolveRealTrackSyncTarget({ storeSlug: 'salvagea' });
    const blackline = resolveRealTrackSyncTarget({ storeSlug: 'blacklineusedautoparts' });
    expect(salvage.name).toBe('Salvage Auto Parts');
    expect(blackline.name).toBe('Blackline Auto Parts');
    expect(salvage.storeId).not.toBe(blackline.storeId);
  });

  it('rejects unknown RealTrack stores', () => {
    expect(() => resolveRealTrackSyncTarget({ storeId: '00000000-0000-0000-0000-000000000000' }))
      .toThrow(/not a marketplace/);
    expect(findMarketplaceSellerByStoreId('eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0')).toBeNull();
  });
});
