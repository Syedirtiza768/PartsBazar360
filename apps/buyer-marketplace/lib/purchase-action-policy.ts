import type { FitmentState } from "./fitment";

export type PurchaseShippingStatus =
  | "CHECKING"
  | "DESTINATION_REQUIRED"
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "FREIGHT_QUOTE"
  | "REVIEW";

export type PurchaseActionPolicy = {
  canPurchase: boolean;
  requiresFitmentAcknowledgment: boolean;
  addLabel: string;
  buyLabel: string;
  blockedLabel: string | null;
  blockedHref: string | null;
  buyHref: string | null;
  /** Short helper line shown under the purchase buttons, if any. */
  note: string | null;
};

/** Shipping states that genuinely stop a purchase for the chosen destination. */
type BlockingShippingStatus = Extract<
  PurchaseShippingStatus,
  "UNAVAILABLE" | "FREIGHT_QUOTE" | "REVIEW"
>;

/**
 * Shared display policy for the PDP offer actions and sticky mobile action.
 *
 * "Add to cart" and "Buy now" stay visible unless something definitely blocks
 * the purchase (no delivery to the chosen country, freight or specialist
 * review, or a known fitment conflict). A missing destination or an unconfirmed
 * fitment does not hide them: checkout collects the address, re-quotes shipping
 * and asks the buyer to acknowledge unconfirmed fitment before payment.
 */
export function selectPurchaseActionPolicy(input: {
  fitment: FitmentState | null;
  hasSelectedVehicle: boolean;
  hasExactIdentifier: boolean;
  shipping: PurchaseShippingStatus;
  garageHref: string;
  alternativesHref: string;
  freightQuoteHref: string;
}): PurchaseActionPolicy {
  if (
    input.shipping === "UNAVAILABLE" ||
    input.shipping === "FREIGHT_QUOTE" ||
    input.shipping === "REVIEW"
  ) {
    const copy: Record<BlockingShippingStatus, string> = {
      UNAVAILABLE: "Delivery is unavailable",
      FREIGHT_QUOTE: "Request a freight quote",
      REVIEW: "Request a shipping review",
    };
    const quoteable = input.shipping !== "UNAVAILABLE";
    return {
      canPurchase: false,
      requiresFitmentAcknowledgment: false,
      addLabel: copy[input.shipping],
      buyLabel: copy[input.shipping],
      blockedLabel: quoteable ? copy[input.shipping] : null,
      blockedHref: quoteable ? input.freightQuoteHref : null,
      buyHref: null,
      note: null,
    };
  }

  const buyable = {
    canPurchase: true,
    addLabel: "Add to cart",
    buyLabel: "Buy now",
    blockedLabel: null,
    blockedHref: null,
    buyHref: null,
  } as const;

  if (input.fitment === "incompatible") {
    return {
      canPurchase: false,
      requiresFitmentAcknowledgment: false,
      addLabel: "Find compatible alternatives",
      buyLabel: "Find compatible alternatives",
      blockedLabel: "This part conflicts with your selected vehicle.",
      blockedHref: input.alternativesHref,
      buyHref: null,
      note: null,
    };
  }
  if (input.fitment === "verified" || input.fitment === "universal") {
    return { ...buyable, requiresFitmentAcknowledgment: false, note: null };
  }
  if (input.fitment === null && input.hasSelectedVehicle) {
    // Compatibility is still loading; keep the buttons and let the result
    // replace this note (or switch to alternatives on a conflict).
    return {
      ...buyable,
      requiresFitmentAcknowledgment: true,
      note: "Checking compatibility with your vehicle…",
    };
  }

  return {
    ...buyable,
    requiresFitmentAcknowledgment: true,
    note: input.hasSelectedVehicle
      ? "Fitment for your vehicle isn't confirmed. You'll confirm it at checkout."
      : input.hasExactIdentifier
        ? "Match the part number to your old part, or select your vehicle to check fitment."
        : "Select your vehicle to check fitment before you buy.",
  };
}
