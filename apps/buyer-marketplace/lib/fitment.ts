import type { CompatibilityRow, Part, PartFitment } from "./types";

/**
 * Fitment verdict for a part against a specific vehicle configuration.
 * The states map 1:1 to the FitmentBadge visual language and are ordered by
 * decreasing confidence. Uncertainty is a first-class state — we never guess.
 */
export type FitmentState =
  | "verified" // structured A/B evidence ≥ 0.8 for this exact configuration
  | "likely" // structured evidence exists but below the verified bar
  | "check" // part has fitment data, none of it for this configuration
  | "incompatible" // reserved: explicit negative evidence (not produced today)
  | "universal" // flagged as universal-fit
  | "unknown"; // no usable fitment data at all

const VERIFIED_LEVELS = new Set(["A", "B"]);
const VERIFIED_MIN_CONFIDENCE = 0.8;
const LIKELY_MIN_CONFIDENCE = 0.5;

export type FitmentVehicleHint = {
  makeName?: string | null;
  modelName?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  trim?: string | null;
};

function normalizeToken(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

function isUniversal(part: Pick<Part, "fitmentFlags">): boolean {
  return (part.fitmentFlags || []).some((f) => f?.toUpperCase().includes("UNIVERSAL"));
}

function yearOverlaps(
  rowYear: number | string | undefined,
  vehicle: FitmentVehicleHint,
): boolean {
  const y =
    typeof rowYear === "number" ? rowYear : parseInt(String(rowYear ?? ""), 10);
  if (!Number.isFinite(y)) return false;
  const start = vehicle.startYear ?? vehicle.endYear;
  const end = vehicle.endYear ?? vehicle.startYear;
  if (start == null && end == null) return true;
  if (start != null && end != null) {
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    return y >= from && y <= to;
  }
  return y === (start ?? end);
}

/** Match garage YMM against OE-catalog / compatibility table rows. */
function fitmentFromCompatibilityTable(
  rows: CompatibilityRow[] | undefined,
  vehicle: FitmentVehicleHint | null | undefined,
): FitmentState | null {
  if (!rows?.length || !vehicle?.makeName || !vehicle?.modelName) return null;
  const nMake = normalizeToken(vehicle.makeName);
  const nModel = normalizeToken(vehicle.modelName);
  if (!nMake || !nModel) return null;

  const matches = rows.filter((row) => {
    if (!yearOverlaps(row.year, vehicle)) return false;
    if (normalizeToken(row.make) !== nMake) return false;
    const rowModel = normalizeToken(row.model);
    return (
      rowModel === nModel ||
      rowModel.startsWith(nModel) ||
      nModel.startsWith(rowModel)
    );
  });
  if (matches.length === 0) return null;

  const verified = matches.some(
    (r) => r.mvlVerified === true || r.source === "mvl_catalog",
  );
  return verified ? "verified" : "likely";
}

/**
 * Evaluate a part against a vehicle configuration id.
 * Handles both payload shapes: index documents (fitments: string[] of
 * verified config ids) and detail payloads (full fitment relations).
 * On PDP, also falls back to compatibilityTable YMM matching so MVL OE-catalog
 * expansion is reflected in "Will this fit?" without persisting Fitment rows.
 */
export function fitmentForConfig(
  part: Pick<
    Part,
    "fitments" | "fitmentFlags" | "compatibilityTable" | "compatibility"
  >,
  configId: string | null | undefined,
  vehicle?: FitmentVehicleHint | null,
): FitmentState {
  if (isUniversal(part)) return "universal";
  const fitments = part.fitments || [];
  const table = part.compatibilityTable || part.compatibility || [];

  if (!configId && !vehicle) {
    return fitments.length > 0 || table.length > 0 ? "check" : "unknown";
  }

  if (fitments.length > 0 && configId) {
    // Index shape: array of verified config-id strings.
    if (typeof fitments[0] === "string") {
      const ids = fitments as string[];
      if (ids.includes(configId)) return "verified";
    } else {
      const relations = fitments as PartFitment[];
      const match = relations.find((f) => f.vehicleConfigId === configId);
      if (match) {
        if (
          VERIFIED_LEVELS.has((match.evidenceLevel || "").toUpperCase()) &&
          Number(match.confidence || 0) >= VERIFIED_MIN_CONFIDENCE
        ) {
          return "verified";
        }
        if (Number(match.confidence || 0) >= LIKELY_MIN_CONFIDENCE) {
          return "likely";
        }
        return "check";
      }
    }
  }

  const fromTable = fitmentFromCompatibilityTable(table, vehicle);
  if (fromTable) return fromTable;

  if (fitments.length > 0 || table.length > 0) return "check";
  return "unknown";
}

export const FITMENT_COPY: Record<
  FitmentState,
  { label: string; withVehicle?: (name: string) => string; explainer: string }
> = {
  verified: {
    label: "Verified fit",
    withVehicle: (name) => `Fits your ${name}`,
    explainer:
      "Confirmed by structured, high-confidence compatibility evidence for this exact configuration.",
  },
  likely: {
    label: "Likely fit",
    withVehicle: (name) => `Likely fits your ${name}`,
    explainer:
      "Compatibility evidence exists for this configuration but hasn't reached verified confidence. Confirm engine and trim before ordering.",
  },
  check: {
    label: "Check fitment",
    withVehicle: (name) => `Not verified for your ${name}`,
    explainer:
      "This part has verified fitment for other vehicles, but not for this configuration. Match the OE number or ask us to verify.",
  },
  incompatible: {
    label: "Doesn't fit",
    withVehicle: (name) => `Doesn't fit your ${name}`,
    explainer:
      "This part is not compatible with the selected vehicle configuration.",
  },
  universal: {
    label: "Universal part",
    explainer:
      "Designed to fit a wide range of vehicles. Check dimensions and connectors before ordering.",
  },
  unknown: {
    label: "Fitment not verified",
    explainer:
      "No structured compatibility data is available yet. Match the OE number or ask support to verify before ordering.",
  },
};
