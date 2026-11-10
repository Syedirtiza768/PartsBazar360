"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  resolveShippingCountry,
  setShippingCountry,
} from "@/lib/shipping-destination";
import { useCurrency } from "@/lib/currency-context";
import { useGarage } from "@/lib/garage-context";
import type { FitmentState } from "@/lib/fitment";
import { usePartFitment } from "@/lib/use-part-fitment";
import {
  usePartShippingQuote,
  type PartShippingQuote,
} from "@/lib/use-part-shipping-quote";
import {
  selectPurchaseActionPolicy,
  type PurchaseActionPolicy,
  type PurchaseShippingStatus,
} from "@/lib/purchase-action-policy";
import type { Part } from "@/lib/types";

type PdpPurchaseState = {
  activeVehicleConfigId: string | null;
  hasSelectedVehicle: boolean;
  fitmentState: FitmentState | null;
  destination: string;
  setDestination: (country: string) => void;
  shippingQuote: PartShippingQuote | null;
  shippingLoading: boolean;
  shippingError: string | null;
  shippingStatus: PurchaseShippingStatus;
  actionPolicy: PurchaseActionPolicy;
};

const PdpPurchaseContext = createContext<PdpPurchaseState | null>(null);

export function PdpPurchaseProvider({
  part,
  children,
}: {
  part: Part;
  children: ReactNode;
}) {
  const { activeVehicle } = useGarage();
  const { detectedCountry, ready: currencyReady } = useCurrency();
  const [destination, setDestination] = useState("");
  const [destinationReady, setDestinationReady] = useState(false);
  const fitmentState = usePartFitment(
    part.id,
    activeVehicle?.configId,
    activeVehicle,
  );
  const requiresFreightQuote = Boolean(part.shipping?.requiresFreightQuote);
  const {
    quote: shippingQuote,
    loading: shippingLoading,
    error: shippingError,
  } = usePartShippingQuote({
    partId: part.id,
    country: destination,
    enabled: destinationReady && Boolean(destination) && !requiresFreightQuote,
  });

  useEffect(() => {
    if (!currencyReady) return;
    setDestination(resolveShippingCountry(detectedCountry));
    setDestinationReady(true);
  }, [currencyReady, detectedCountry]);

  useEffect(() => {
    if (destinationReady) setShippingCountry(destination);
  }, [destination, destinationReady]);

  const shippingStatus: PurchaseShippingStatus = requiresFreightQuote
    ? "FREIGHT_QUOTE"
    : !destinationReady
      ? "CHECKING"
      : shippingLoading
        ? "CHECKING"
        : !destination
          ? "DESTINATION_REQUIRED"
          : shippingQuote?.requiresFreightQuote
            ? "FREIGHT_QUOTE"
            : shippingQuote?.availabilityReason === "SPECIAL_HANDLING_REVIEW"
              ? "REVIEW"
              : shippingQuote?.available && shippingQuote.amount != null
                ? "AVAILABLE"
                : shippingError || shippingQuote
                  ? "UNAVAILABLE"
                  : "CHECKING";

  const actionPolicy = useMemo(
    () =>
      selectPurchaseActionPolicy({
        fitment: activeVehicle ? fitmentState : "unknown",
        hasSelectedVehicle: Boolean(activeVehicle),
        hasExactIdentifier: Boolean(
          part.manufacturerPartNumber || part.oeNumbers?.length,
        ),
        shipping: shippingStatus,
        garageHref: "/garage",
        alternativesHref: `/search?q=${encodeURIComponent(
          part.manufacturerPartNumber || part.oeNumbers?.[0] || part.title,
        )}`,
        freightQuoteHref: `/support?partId=${encodeURIComponent(part.id)}&category=FREIGHT_QUOTE&subject=${encodeURIComponent(`Shipping quote: ${part.title}`)}`,
      }),
    [
      activeVehicle,
      fitmentState,
      part.id,
      part.manufacturerPartNumber,
      part.oeNumbers,
      part.title,
      shippingStatus,
    ],
  );

  const value = useMemo<PdpPurchaseState>(
    () => ({
      activeVehicleConfigId: activeVehicle?.configId ?? null,
      hasSelectedVehicle: Boolean(activeVehicle),
      fitmentState,
      destination,
      setDestination,
      shippingQuote,
      shippingLoading,
      shippingError,
      shippingStatus,
      actionPolicy,
    }),
    [
      activeVehicle,
      actionPolicy,
      destination,
      fitmentState,
      shippingError,
      shippingLoading,
      shippingQuote,
      shippingStatus,
    ],
  );

  return (
    <PdpPurchaseContext.Provider value={value}>
      {children}
    </PdpPurchaseContext.Provider>
  );
}

export function usePdpPurchaseState() {
  const state = useContext(PdpPurchaseContext);
  if (!state) {
    throw new Error("PDP purchase controls must be inside PdpPurchaseProvider");
  }
  return state;
}
