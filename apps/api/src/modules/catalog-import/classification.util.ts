import { normalizeMasterName } from './part-normalization.util';

export interface ClassificationResult {
  partType: string;
  confidence: number;
  status: 'READY' | 'REVIEW_RECOMMENDED' | 'ACTION_REQUIRED';
  reasons: string[];
}

const CLEAR_AFTERMARKET = new Set(['FEBEST', 'GATES', 'MEYLE', 'SKF', 'ASHIKA', 'AUTOMEGA', 'ASIAN PARTS']);
const MULTI_ROLE = new Set(['BOSCH', 'DENSO', 'MOBIS']);

export function classifyPart(input: {
  declaredType?: string;
  brand?: string;
  condition?: string;
  donorEvidence?: boolean;
  sourceContext?: 'AFTERMARKET_CATALOG' | 'MIXED_CATALOG' | 'EBAY';
}): ClassificationResult {
  const declared = normalizeMasterName(input.declaredType);
  const brand = normalizeMasterName(input.brand);
  const condition = normalizeMasterName(input.condition);
  const reasons: string[] = [];

  if (input.donorEvidence || declared.includes('SALVAGE') || declared.includes('USED ORIGINAL')) {
    return { partType: 'SALVAGE_OEM', confidence: input.donorEvidence ? 0.96 : 0.72, status: input.donorEvidence ? 'READY' : 'REVIEW_RECOMMENDED', reasons: ['Used-original declaration or donor evidence'] };
  }
  if (declared.includes('REMAN')) return { partType: 'REMANUFACTURED', confidence: 0.9, status: 'READY', reasons: ['Seller-declared remanufactured'] };
  if (declared.includes('REFURB')) return { partType: 'REFURBISHED', confidence: 0.9, status: 'READY', reasons: ['Seller-declared refurbished'] };
  if (declared.includes('AFTER') || input.sourceContext === 'AFTERMARKET_CATALOG') {
    reasons.push('Aftermarket seller declaration or catalog context');
    if (brand) reasons.push(`Product brand ${input.brand}`);
    return { partType: 'AFTERMARKET', confidence: brand ? 0.96 : 0.75, status: brand ? 'READY' : 'REVIEW_RECOMMENDED', reasons };
  }
  if (CLEAR_AFTERMARKET.has(brand)) return { partType: 'AFTERMARKET', confidence: 0.9, status: 'READY', reasons: ['Brand master identifies a clear aftermarket brand'] };
  if (MULTI_ROLE.has(brand)) return { partType: 'UNCLASSIFIED', confidence: 0.5, status: 'REVIEW_RECOMMENDED', reasons: ['Brand operates in OEM-supply and aftermarket roles; product evidence is required'] };
  if (declared.includes('GENUINE') || declared === 'OEM') return { partType: 'GENUINE_OEM', confidence: 0.65, status: 'REVIEW_RECOMMENDED', reasons: ['Seller-declared genuine/OEM; authenticity evidence is still required'] };
  if (condition.includes('USED')) reasons.push('Used condition alone does not prove original or donor provenance');
  reasons.push('Brand or vehicle-make-looking label alone cannot determine part type');
  return { partType: 'UNCLASSIFIED', confidence: 0.25, status: 'ACTION_REQUIRED', reasons };
}
