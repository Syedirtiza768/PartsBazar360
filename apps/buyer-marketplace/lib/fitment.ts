import type { Part, PartFitment } from "./types";

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

function isUniversal(part: Pick<Part, "fitmentFlags">): boolean {
  return (part.fitmentFlags || []).some((f) => f?.toUpperCase().includes("UNIVERSAL"));
}

/**
 * Evaluate a part against a vehicle configuration id.
 * Handles both payload shapes: index documents (fitments: string[] of
 * verified config ids) and detail payloads (full fitment relations).
 */
export function fitmentForConfig(
  part: Pick<Part, "fitments" | "fitmentFlags">,
  configId: string | null | undefined,
): FitmentState {
  if (isUniversal(part)) return "universal";
  const fitments = part.fitments || [];
  if (!configId) return fitments.length > 0 ? "check" : "unknown";
  if (fitments.length === 0) return "unknown";

  // Index shape: array of verified config-id strings.
  if (typeof fitments[0] === "string") {
    const ids = fitments as string[];
    return ids.includes(configId) ? "verified" : "check";
  }

  const relations = fitments as PartFitment[];
  const match = relations.find((f) => f.vehicleConfigId === configId);
  if (!match) return "check";
  if (
    VERIFIED_LEVELS.has((match.evidenceLevel || "").toUpperCase()) &&
    Number(match.confidence || 0) >= VERIFIED_MIN_CONFIDENCE
  ) {
    return "verified";
  }
  if (Number(match.confidence || 0) >= LIKELY_MIN_CONFIDENCE) return "likely";
  return "check";
}

export const FITMENT_COPY: Record<
  FitmentState,
  { label: string; withVehicle?: (name: string) => string; explainer: string }
> = {
  verified: {
    label: "Verified fit",
    withVehicle: (name) => `Fits your ${name}`,
    explainer: "Confirmed by structured, high-confidence compatibility evidence for this exact configuration.",
  },
  likely: {
    label: "Likely fit",
    withVehicle: (name) => `Likely fits your ${name}`,
    explainer: "Compatibility evidence exists for this configuration but hasn't reached verified confidence. Confirm engine and trim before ordering.",
  },
  check: {
    label: "Check fitment",
    withVehicle: (name) => `Not verified for your ${name}`,
    explainer: "This part has verified fitment for other vehicles, but not for this configuration. Match the OE number or ask us to verify.",
  },
  incompatible: {
    label: "Doesn't fit",
    withVehicle: (name) => `Doesn't fit your ${name}`,
    explainer: "This part is not compatible with the selected vehicle configuration.",
  },
  universal: {
    label: "Universal part",
    explainer: "Designed to fit a wide range of vehicles. Check dimensions and connectors before ordering.",
  },
  unknown: {
    label: "Fitment not verified",
    explainer: "No structured compatibility data is available yet. Match the OE number or ask support to verify before ordering.",
  },
};
