/**
 * Source tag resolution for listing provenance.
 *
 * Every SellerOffer carries a 3-char `sourceTag` that identifies where the
 * listing came from. The buyer marketplace uses these for pill badges and
 * filtering.
 *
 * Tag map:
 *   FEB  — FEBEST_AVAILABILITY (spreadsheet)
 *   DYN  — DYNATRADE_STOCK     (spreadsheet)
 *   TRU  — TRADE_UNION          (spreadsheet)
 *   DXB  — DXB_EXW              (spreadsheet)
 *   SPC  — SPARCO_STOCK         (spreadsheet)
 *   SPD  — SPARCO_DEAD_STOCK    (spreadsheet)
 *   SAL  — RealTrack Salvage Auto Parts (eBay)
 *   BLK  — RealTrack Blackline Auto Parts (eBay)
 *   GEN  — GENERIC / unclassified spreadsheet uploads
 */

import type { ImportTemplate } from './spreadsheet-parser.service';
import {
  SALVAGE_STORE_ID,
  BLACKLINE_STORE_ID,
} from '../seed/marketplace-sellers.config';

export const SOURCE_TAGS = [
  'FEB', 'DYN', 'TRU', 'DXB', 'SPC', 'SPD',
  'SAL', 'BLK', 'GEN',
] as const;

export type SourceTag = (typeof SOURCE_TAGS)[number];

export const SOURCE_TAG_LABELS: Record<SourceTag, string> = {
  FEB: 'FEBEST',
  DYN: 'Dynatrade',
  TRU: 'Trade Union',
  DXB: 'DXB EXW',
  SPC: 'Sparco',
  SPD: 'Sparco Dead Stock',
  SAL: 'Salvage',
  BLK: 'Blackline',
  GEN: 'General',
};

const TEMPLATE_TO_TAG: Record<ImportTemplate, SourceTag> = {
  FEBEST_AVAILABILITY: 'FEB',
  DYNATRADE_STOCK: 'DYN',
  TRADE_UNION: 'TRU',
  DXB_EXW: 'DXB',
  SPARCO_STOCK: 'SPC',
  SPARCO_DEAD_STOCK: 'SPD',
  GENERIC: 'GEN',
};

const STORE_ID_TO_TAG: Record<string, SourceTag> = {
  [SALVAGE_STORE_ID]: 'SAL',
  [BLACKLINE_STORE_ID]: 'BLK',
};

/** Resolve sourceTag from a spreadsheet import template. */
export function tagFromTemplate(template: ImportTemplate): SourceTag {
  return TEMPLATE_TO_TAG[template] ?? 'GEN';
}

/** Resolve sourceTag from a RealTrack storeId. */
export function tagFromStoreId(storeId: string | null | undefined): SourceTag {
  if (!storeId) return 'GEN';
  return STORE_ID_TO_TAG[storeId] ?? 'GEN';
}

export function sourceTagLabel(tag: string | null | undefined): string {
  if (!tag) return SOURCE_TAG_LABELS.GEN;
  return SOURCE_TAG_LABELS[tag as SourceTag] ?? tag;
}
