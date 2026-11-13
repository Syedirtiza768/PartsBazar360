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
};

/** Shared display policy for the PDP offer actions and sticky mobile action. */
export function selectPurchaseActionPolicy(input: {
  fitment: FitmentState | null;
  hasSelectedVehicle: boolean;
  hasExactIdentifier: boolean;
  shipping: PurchaseShippingStatus;
  garageHref: string;
  alternativesHref: string;
  freightQuoteHref: string;
}): PurchaseActionPolicy {
  if (input.shipping !== "AVAILABLE") {
    const copy: Record<Exclude<PurchaseShippingStatus, "AVAILABLE">, string> = {
      CHECKING: "Checking delivery",
      DESTINATION_REQUIRED: "Choose a delivery destination",
      UNAVAILABLE: "Delivery is unavailable",
      FREIGHT_QUOTE: "Request a freight quote",
      REVIEW: "Request a shipping review",
    };
    const freight = input.shipping === "FREIGHT_QUOTE";
    const review = input.shipping === "REVIEW";
    const destinationRequired = input.shipping === "DESTINATION_REQUIRED";
    return {
      canPurchase: false,
      requiresFitmentAcknowledgment: false,
      addLabel: copy[input.shipping],
      buyLabel: copy[input.shipping],
      blockedLabel:
        freight || review || destinationRequired ? copy[input.shipping] : null,
      blockedHref:
        freight || review
          ? input.freightQuoteHref
          : destinationRequired
            ? "#shipping-destination"
            : null,
      buyHref: null,
    };
  }

  if (input.fitment === null && input.hasSelectedVehicle) {
    return {
      canPurchase: false,
      requiresFitmentAcknowledgment: false,
      addLabel: "Checking compatibility",
      buyLabel: "Checking compatibility",
      blockedLabel: null,
      blockedHref: null,
      buyHref: null,
    };
  }
  if (input.fitment === "incompatible") {
    return {
      canPurchase: false,
      requiresFitmentAcknowledgment: false,
      addLabel: "Find compatible alternatives",
      buyLabel: "Find compatible alternatives",
      blockedLabel: "This part conflicts with your selected vehicle.",
      blockedHref: input.alternativesHref,
      buyHref: null,
    };
  }
  if (input.fitment === "verified" || input.fitment === "universal") {
    return {
      canPurchase: true,
      requiresFitmentAcknowledgment: false,
      addLabel: "Add to cart",
      buyLabel: "Buy now",
      blockedLabel: null,
      blockedHref: null,
      buyHref: null,
    };
  }

  if (!input.hasSelectedVehicle) {
    if (!input.hasExactIdentifier) {
      return {
        canPurchase: false,
        requiresFitmentAcknowledgment: false,
        addLabel: "Select a vehicle to check fitment",
        buyLabel: "Check fitment",
        blockedLabel: "Select a vehicle to check fitment",
        blockedHref: input.garageHref,
        buyHref: input.garageHref,
      };
    }

    return {
      canPurchase: true,
      requiresFitmentAcknowledgment: true,
      addLabel: "Add without a vehicle",
      buyLabel: "Check fitment",
      blockedLabel: null,
      blockedHref: null,
      buyHref: input.garageHref,
    };
  }

  return {
    canPurchase: true,
    requiresFitmentAcknowledgment: true,
    addLabel: input.hasSelectedVehicle
      ? "Add for compatibility review"
      : "Add without a vehicle",
    buyLabel: input.hasSelectedVehicle
      ? "Continue with fitment review"
      : "Continue without a vehicle",
    blockedLabel: null,
    blockedHref: null,
    buyHref: null,
  };
}
