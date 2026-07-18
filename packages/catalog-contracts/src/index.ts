/** Shared catalog vocabulary used by API, seed, buyer, seller, and admin. */

export const PART_TYPES = [
  'GENUINE_OEM',
  'OEM_EQUIVALENT',
  'AFTERMARKET',
  'SALVAGE_OEM',
  'REMANUFACTURED',
  'REFURBISHED',
  'PERFORMANCE',
  'UNIVERSAL',
  'UNCLASSIFIED',
] as const;

export type PartType = (typeof PART_TYPES)[number];

export const PART_TYPE_LABELS: Record<PartType, string> = {
  GENUINE_OEM: 'Genuine OEM',
  OEM_EQUIVALENT: 'OEM-equivalent',
  AFTERMARKET: 'Aftermarket',
  SALVAGE_OEM: 'Used Original',
  REMANUFACTURED: 'Remanufactured',
  REFURBISHED: 'Refurbished',
  PERFORMANCE: 'Performance / Upgrade',
  UNIVERSAL: 'Universal',
  UNCLASSIFIED: 'Unclassified',
};

export const NUMBER_TYPES = [
  'BRAND_MPN',
  'OEM',
  'OEM_CROSS_REFERENCE',
  'SUPERSEDED',
  'REPLACED_BY',
  'INTERCHANGE',
  'SELLER_SKU',
] as const;

export type NumberType = (typeof NUMBER_TYPES)[number];

export const FITMENT_EVIDENCE_LEVELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type FitmentEvidenceLevel = (typeof FITMENT_EVIDENCE_LEVELS)[number];

export const FITMENT_STATUSES = [
  'CONFIRMED',
  'LIKELY',
  'OEM_NUMBER_MATCH',
  'DETAILS_REQUIRED',
  'NOT_VERIFIED',
  'DOES_NOT_FIT',
  'UNIVERSAL',
] as const;

export type FitmentStatus = (typeof FITMENT_STATUSES)[number];

export const FITMENT_STATUS_LABELS: Record<FitmentStatus, string> = {
  CONFIRMED: 'Confirmed to fit',
  LIKELY: 'Likely fit',
  OEM_NUMBER_MATCH: 'OEM number matches',
  DETAILS_REQUIRED: 'Additional vehicle details required',
  NOT_VERIFIED: 'Fitment has not been verified',
  DOES_NOT_FIT: 'Does not fit',
  UNIVERSAL: 'Universal fit',
};

export const REVIEW_QUEUE_TYPES = [
  'CLASSIFICATION',
  'UNRECOGNIZED_BRAND',
  'UNRECOGNIZED_MAKE',
  'OEM_PARSE',
  'MATCH_CONFLICT',
  'FITMENT_VERIFICATION',
  'OEM_AUTHENTICITY',
  'SALVAGE_QUALITY',
  'IMPORT_FAILURE',
  'DUPLICATE_PRODUCT',
] as const;

export type ReviewQueueType = (typeof REVIEW_QUEUE_TYPES)[number];

export const IMPORT_JOB_STATUSES = [
  'UPLOADED',
  'DETECTING',
  'MAPPING',
  'STAGING',
  'PREVIEW_READY',
  'COMMITTING',
  'PROCESSING',
  'NEEDS_REVIEW',
  'COMPLETED',
  'FAILED',
] as const;

export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const IMPORT_ROW_STATUSES = [
  'STAGED',
  'READY',
  'NEEDS_REVIEW',
  'IMPORTED',
  'INVALID',
  'REJECTED',
  'SKIPPED',
] as const;

export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'CLASSIFY',
  'NORMALIZE',
  'MATCH',
  'MERGE',
  'FITMENT_ATTACH',
  'FITMENT_VERIFY',
  'IMPORT_STAGE',
  'IMPORT_COMMIT',
  'ALIAS_CREATE',
  'REVIEW_RESOLVE',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isPartType(value: string | null | undefined): value is PartType {
  return !!value && (PART_TYPES as readonly string[]).includes(value);
}

export function partTypeLabel(value: string | null | undefined): string {
  if (isPartType(value)) return PART_TYPE_LABELS[value];
  return value || PART_TYPE_LABELS.UNCLASSIFIED;
}

/** Map legacy partSource to controlled part type when partType is absent. */
export function partTypeFromLegacy(partSource?: string | null, partType?: string | null): PartType {
  if (isPartType(partType)) return partType;
  if ((partSource || '').toUpperCase().includes('AFTER')) return 'AFTERMARKET';
  return 'UNCLASSIFIED';
}

/** Search may treat only A/B evidence as verified-fit candidates. */
export function isVerifiedFitmentEvidence(level: string | null | undefined, confidence = 0): boolean {
  return (level === 'A' || level === 'B') && confidence >= 0.8;
}
