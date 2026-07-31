/**
 * Source tag resolution for listing provenance.
 *
 * Every SellerOffer carries a 3-char `sourceTag` that identifies where the
 * listing came from. The buyer marketplace uses these for pill badges and
 * filtering.
 *
 * Tag map:
 *   BST  — FEBEST_AVAILABILITY (spreadsheet)
 *   AAP  — DXB_EXW              (spreadsheet)
 *   YNTD — DYNATRADE_STOCK     (spreadsheet)
 *   PSRC — SPARCO_STOCK / SPARCO_DEAD_STOCK (spreadsheet)
 *   TNRU — TRADE_UNION          (spreadsheet)
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
  'BST', 'AAP', 'YNTD', 'PSRC', 'TNRU',
  'SAL', 'BLK', 'GEN',
] as const;

export type SourceTag = (typeof SOURCE_TAGS)[number];

export const SOURCE_TAG_LABELS: Record<SourceTag, string> = {
  BST: 'FEBEST',
  AAP: 'DXB EXW',
  YNTD: 'Dynatrade',
  PSRC: 'Sparco',
  TNRU: 'Trade Union',
  SAL: 'Salvage',
  BLK: 'Blackline',
  GEN: 'General',
};

const TEMPLATE_TO_TAG: Record<ImportTemplate, SourceTag> = {
  FEBEST_AVAILABILITY: 'BST',
  DYNATRADE_STOCK: 'YNTD',
  TRADE_UNION: 'TNRU',
  DXB_EXW: 'AAP',
  SPARCO_STOCK: 'PSRC',
  SPARCO_DEAD_STOCK: 'PSRC',
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
