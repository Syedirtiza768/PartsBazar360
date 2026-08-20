/**
 * Canonical get-or-create for VehicleConfiguration rows (QA-03).
 *
 * The three historical creation sites (merchant uploads, ingestion processor,
 * MVL fitment service) each did `findFirst({ generationId })` (or
 * `{ generationId, market }`) followed by `create` — with no unique
 * constraint. Under the parallel MVL recovery workers that check-then-create
 * raced, producing buyer-indistinguishable duplicate configurations whose
 * fitments then split across the twins (same vehicle → 52 vs 162 vs 165
 * parts depending on which duplicate the picker resolved).
 *
 * Identity = generation + the buyer-visible display fields (trim, engine,
 * transmission, drivetrain, fuel), compared case-insensitively with NULL/''-
 * normalization. `market` is provenance (which source catalog created the
 * row), NOT part of the buyer-visible identity: a US-sourced and a
 * GLOBAL-sourced row with identical display fields are the same vehicle to a
 * buyer, so they resolve to the same config.
 *
 * Race safety: once the `VehicleConfiguration_display_identity_key` migration
 * is applied, a losing concurrent `create` raises P2002 and we return the
 * winner's row. Before the migration lands this degrades to the old
 * findFirst-then-create behaviour — no worse than the status quo, and never
 * an error.
 */

export interface VehicleConfigIdentity {
  generationId: string;
  trim?: string | null;
  engine?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  fuel?: string | null;
  /** Provenance only — recorded on create, never part of the identity. */
  market?: string | null;
}

/** Minimal store surface so the resolver is unit-testable without Prisma. */
export interface VehicleConfigStore {
  vehicleConfiguration: {
    findFirst(args: { where: Record<string, unknown> }): Promise<any>;
    create(args: { data: Record<string, unknown> }): Promise<any>;
  };
}

const DISPLAY_FIELDS = [
  'trim',
  'engine',
  'transmission',
  'drivetrain',
  'fuel',
] as const;

/** '' / whitespace / null all mean "unspecified"; comparison is caseless. */
export function normalizeConfigField(
  value: string | null | undefined,
): string | null {
  const v = String(value ?? '').trim();
  return v ? v : null;
}

function identityWhere(input: VehicleConfigIdentity) {
  const where: Record<string, unknown> = { generationId: input.generationId };
  for (const field of DISPLAY_FIELDS) {
    const v = normalizeConfigField(input[field]);
    where[field] = v === null ? null : { equals: v, mode: 'insensitive' };
  }
  return where;
}

/**
 * Resolve the one canonical configuration for a vehicle identity, creating it
 * when absent. Concurrent creators converge on a single row (see header).
 */
export async function resolveVehicleConfiguration(
  store: VehicleConfigStore,
  input: VehicleConfigIdentity,
) {
  const where = identityWhere(input);
  const existing = await store.vehicleConfiguration.findFirst({ where });
  if (existing) return existing;

  const data: Record<string, unknown> = {
    generationId: input.generationId,
    market: input.market ?? null,
  };
  for (const field of DISPLAY_FIELDS) {
    data[field] = normalizeConfigField(input[field]);
  }

  try {
    return await store.vehicleConfiguration.create({ data });
  } catch (error: any) {
    // Lost a create race against the display-identity unique index: the
    // winner's row is canonical — fetch and return it.
    if (error?.code === 'P2002') {
      const winner = await store.vehicleConfiguration.findFirst({ where });
      if (winner) return winner;
    }
    throw error;
  }
}
