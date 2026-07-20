/**
 * Initial marketplace seller map.
 *
 * RealTrack isolation rules:
 * - Salvage Auto Parts  ← ONLY US SalvageA store
 * - Blackline Auto Parts ← ONLY blacklineusedautoparts store
 * - Superior Auto Parts  ← spreadsheet uploads only (no RealTrack store)
 */

export const SALVAGE_STORE_ID = '3b84b063-3811-481f-a61d-f7846a03558f';
export const BLACKLINE_STORE_ID = 'd16199c4-55b5-429e-ad27-892bed94e00d';

export type MarketplaceSellerKey = 'salvage' | 'blackline' | 'superior';

export interface MarketplaceSellerConfig {
  key: MarketplaceSellerKey;
  /** Stable seller primary key used by seed / auth. */
  id: string;
  name: string;
  /** RealTrack store UUID — null for spreadsheet-only sellers. */
  storeId: string | null;
  /** Optional RealTrack storeSlug when the API prefers slug filters. */
  storeSlug: string | null;
  sourcePlatform: 'EBAY_REALTRACK' | 'SPREADSHEET';
  externalAccountId: string;
}

export const MARKETPLACE_ORG = {
  id: 'org-partsbazar-marketplace',
  name: 'PartsBazar Marketplace',
} as const;

export const MARKETPLACE_SELLERS: Record<MarketplaceSellerKey, MarketplaceSellerConfig> = {
  salvage: {
    key: 'salvage',
    id: 'seller-salvage-auto-parts',
    name: 'Salvage Auto Parts',
    storeId: SALVAGE_STORE_ID,
    // storeSlug 'salvagea' currently returns empty from RealTrack; use storeId only.
    storeSlug: null,
    sourcePlatform: 'EBAY_REALTRACK',
    externalAccountId: SALVAGE_STORE_ID,
  },
  blackline: {
    key: 'blackline',
    id: 'seller-blackline-auto-parts',
    name: 'Blackline Auto Parts',
    storeId: BLACKLINE_STORE_ID,
    storeSlug: 'blacklineusedautoparts',
    sourcePlatform: 'EBAY_REALTRACK',
    externalAccountId: BLACKLINE_STORE_ID,
  },
  superior: {
    key: 'superior',
    id: 'seller-superior-auto-parts',
    name: 'Superior Auto Parts',
    storeId: null,
    storeSlug: null,
    sourcePlatform: 'SPREADSHEET',
    externalAccountId: 'superior-spreadsheet',
  },
};

/** RealTrack-backed sellers only — used by sync jobs and seed. */
export const REALTRACK_MARKETPLACE_SELLERS = [
  MARKETPLACE_SELLERS.salvage,
  MARKETPLACE_SELLERS.blackline,
] as const;

export function findMarketplaceSellerByStoreId(storeId: string | null | undefined) {
  if (!storeId) return null;
  return REALTRACK_MARKETPLACE_SELLERS.find((s) => s.storeId === storeId) ?? null;
}

export function findMarketplaceSellerBySlug(slug: string | null | undefined) {
  if (!slug) return null;
  const raw = slug.toLowerCase().trim();
  const normalized = raw.replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, MarketplaceSellerKey> = {
    salvage: 'salvage',
    salvagea: 'salvage',
    salvageautoparts: 'salvage',
    blackline: 'blackline',
    blacklineusedautoparts: 'blackline',
    blacklineautoparts: 'blackline',
    blacklineautopartsstore: 'blackline',
  };
  const aliased = aliases[normalized];
  if (aliased) return MARKETPLACE_SELLERS[aliased];
  return (
    REALTRACK_MARKETPLACE_SELLERS.find((s) => {
      if (s.storeSlug && s.storeSlug.toLowerCase() === raw) return true;
      const nameKey = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return nameKey === normalized;
    }) ?? null
  );
}

/** Resolve a sync target to a single RealTrack store — never mixes sellers. */
export function resolveRealTrackSyncTarget(input: {
  storeId?: string;
  storeSlug?: string;
}): MarketplaceSellerConfig {
  if (input.storeId) {
    const byId = findMarketplaceSellerByStoreId(input.storeId);
    if (byId) return byId;
    throw new Error(`Store ${input.storeId} is not a marketplace RealTrack seller`);
  }
  if (input.storeSlug) {
    const bySlug = findMarketplaceSellerBySlug(input.storeSlug);
    if (bySlug) return bySlug;
    throw new Error(
      `Store slug "${input.storeSlug}" is not mapped to Salvage Auto Parts or Blackline Auto Parts`,
    );
  }
  throw new Error('storeId or storeSlug is required');
}
