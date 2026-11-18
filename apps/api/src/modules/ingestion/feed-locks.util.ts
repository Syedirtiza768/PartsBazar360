/**
 * Feed locks: per-part protection for listing text that staff repaired.
 *
 * RealTrack pull/push ingestion and RealTrack Trading enrichment rewrite a
 * part's title, brand, category and description from the feed on every run.
 * A bulk repair of those fields would be undone within hours. A part lists the
 * fields it protects in `CanonicalPart.feedLockedFields`. Feed writers spread
 * `preserveFeedLockedFields(part)` last in their update payload, which writes
 * the stored values back over the feed values.
 *
 * Only feed writers apply locks. Staff edits (admin listings, merchant uploads)
 * are deliberate and still write through.
 */

export const FEED_LOCKABLE_FIELDS = [
  'title',
  'brand',
  'category',
  'description',
] as const;

export type FeedLockableField = (typeof FEED_LOCKABLE_FIELDS)[number];

/** Columns that move together with a locked field. */
const COMPANION_FIELDS: Partial<Record<FeedLockableField, readonly string[]>> =
  {
    title: ['normalizedTitle'],
  };

type PreservedKey = FeedLockableField | 'normalizedTitle';

interface FeedLockedPart {
  feedLockedFields?: readonly string[] | null;
}

const LOCKABLE = new Set<string>(FEED_LOCKABLE_FIELDS);

/** The recognised lock names in `locked`, ignoring unknown entries. */
export function activeFeedLocks(
  locked: readonly string[] | null | undefined,
): FeedLockableField[] {
  if (!locked?.length) return [];
  return [...new Set(locked)].filter((field): field is FeedLockableField =>
    LOCKABLE.has(field),
  );
}

/**
 * The part's stored values for its locked fields (and their companion
 * columns). Spread it last in a feed update so those columns keep their value.
 * Fields absent from `part` (not selected) are left out.
 */
export function preserveFeedLockedFields<P extends FeedLockedPart>(
  part: P,
): Partial<Pick<P, Extract<keyof P, PreservedKey>>> {
  const source = part as unknown as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const field of activeFeedLocks(part.feedLockedFields)) {
    for (const key of [field, ...(COMPANION_FIELDS[field] ?? [])]) {
      if (key in source) kept[key] = source[key];
    }
  }
  return kept as Partial<Pick<P, Extract<keyof P, PreservedKey>>>;
}
