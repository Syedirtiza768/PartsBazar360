export interface SeedStoreConfig { storeId: string; name: string; }

import {
  MARKETPLACE_SELLERS,
  REALTRACK_MARKETPLACE_SELLERS,
} from './marketplace-sellers.config';

/** @deprecated Prefer REALTRACK_MARKETPLACE_SELLERS — full 11-store reader manifest. */
export const REALTRACK_STORE_MANIFEST: SeedStoreConfig[] = [
  { storeId: '79f249a5-31e0-42a8-978c-a99b0665c61b', name: 'All About Mercedes' },
  { storeId: 'fa528c8a-f249-4816-94f6-f2ce8b932449', name: 'B.JLRWORLD' },
  { storeId: 'd16199c4-55b5-429e-ad27-892bed94e00d', name: 'BLACKLINEAUTOPARTS' },
  { storeId: '5fc75f19-31f3-44e4-b1ae-6545055f7945', name: 'K. Brit Auto Depot - UK' },
  { storeId: '65aff8ec-21ee-460f-af17-20daa0b843c1', name: 'K. Euro Japan Auto Parts' },
  { storeId: 'eed3dbd6-9967-43ac-ad4e-6d5081cfb9b0', name: 'K. Salvage Auto Parts' },
  { storeId: 'cc658cc0-ab21-4519-9f06-4aea8ff6a809', name: 'K. Salvage Dismantlers - DE' },
  { storeId: '7658e52e-4dd6-48a7-ad78-6933630bdac7', name: 'K. Southern Cross Auto Parts - AU' },
  { storeId: 'cfcc4a9c-c41b-4166-ab41-989c00a6fad1', name: 'Primemotive' },
  { storeId: '8d7d8b23-d769-4ed5-91e2-e26d14a45215', name: 'VW & RR' },
  { storeId: '70ad5c44-6424-4998-815c-99adf28c2487', name: 'eBay store' },
];

/** Initial marketplace: Salvage + Blackline RealTrack stores only. */
export const INITIAL_MARKETPLACE_REALTRACK_STORES: SeedStoreConfig[] =
  REALTRACK_MARKETPLACE_SELLERS.map((s) => ({ storeId: s.storeId!, name: s.name }));

export { MARKETPLACE_SELLERS, REALTRACK_MARKETPLACE_SELLERS };

export function enabled(name: string, fallback = false) {
  const value = process.env[name];
  return value === undefined ? fallback : /^(1|true|yes)$/i.test(value);
}

export function listingLimit() {
  const raw = process.env.SEED_EBAY_LISTING_LIMIT?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function storeManifest(): SeedStoreConfig[] {
  if (process.env.REALTRACK_STORE_MANIFEST_JSON) {
    const parsed = JSON.parse(process.env.REALTRACK_STORE_MANIFEST_JSON);
    if (!Array.isArray(parsed)) throw new Error('REALTRACK_STORE_MANIFEST_JSON must be an array');
    return parsed;
  }
  // Default seed path is the initial 3-seller marketplace (2 RealTrack stores).
  if (enabled('SEED_ALL_REALTRACK_STORES')) return REALTRACK_STORE_MANIFEST;
  return INITIAL_MARKETPLACE_REALTRACK_STORES;
}
