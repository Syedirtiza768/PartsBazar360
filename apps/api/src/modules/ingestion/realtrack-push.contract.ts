/**
 * Contract shared by the HTTP receiver (`realtrack-publish`, API container) and
 * the `ingestion` worker for listings that RealTrack pushes to PartsBazar360.
 *
 * The API container runs with RUN_INGESTION_WORKER=0, so it cannot call
 * IngestionProcessor directly: it validates + enqueues a `push-listing` job and
 * the worker performs the catalog write through the same `processListing`
 * pipeline the pull sync uses (eligibility, pricing quote, MVL fitment, search
 * outbox). Status flows back through a short-lived Redis key.
 */

/**
 * Pushed listings are namespaced by prefixing RealTrack's listing id. That
 * keeps their `externalOfferId` / `sourceKey` / RawStagingListing id disjoint
 * from pull-synced rows, and lets the pull sync's tombstone pass recognise and
 * skip them (a pull sweep never sees pushed ids, so it would otherwise
 * deactivate every pushed offer).
 */
export const PUSH_ID_PREFIX = 'push:';

/**
 * Offer-level id for a pushed listing. Scoped by store as well as source id:
 * processListing matches offers on externalOfferId globally, so the same
 * RealTrack listing published to two PartsBazar sellers must not collide.
 */
export function pushListingId(storeId: string, sourceListingId: string) {
  return `${PUSH_ID_PREFIX}${storeId}:${sourceListingId}`;
}

export const PUSH_JOB_NAME = 'push-listing';

export const PUSH_STATUS_TTL_SECONDS = 7 * 24 * 60 * 60;

export const PUSH_QUALITY_TIERS = [
  'NEW',
  'USED',
  'REFURBISHED',
  'REMANUFACTURED',
  'FOR_PARTS',
] as const;
export type PushQualityTier = (typeof PUSH_QUALITY_TIERS)[number];

export const PUSH_PART_SOURCES = ['OEM', 'AFTERMARKET'] as const;
export type PushPartSource = (typeof PUSH_PART_SOURCES)[number];

/** Optional provenance hints from RealTrack; absent fields keep pull defaults. */
export interface PushProvenanceHints {
  qualityTier?: PushQualityTier;
  partSource?: PushPartSource;
  partType?: string;
}

export interface PushListingJobData {
  /** RealTrack listing id, WITHOUT the push prefix. */
  sourceListingId: string;
  /** PartsBazar `Seller.storeId` the listing belongs to. */
  storeId: string;
  /** Published-listing shaped payload (see docs/apps/api.md). */
  listing: Record<string, unknown>;
  hints?: PushProvenanceHints;
}

export type PushListingStatus =
  'queued' | 'imported' | 'rejected' | 'failed' | 'ended';

export interface PushListingStatusRecord {
  status: PushListingStatus;
  /** processListing outcome, e.g. `imported` or `skipped_non_english_title`. */
  outcome?: string;
  error?: string;
  at: string;
}

export function pushStatusKey(storeId: string, sourceListingId: string) {
  return `rtpush:status:${storeId}:${sourceListingId}`;
}
