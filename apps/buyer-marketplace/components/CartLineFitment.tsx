"use client";

import { FitmentBadge } from "./FitmentBadge";
import { usePartFitment } from "@/lib/use-part-fitment";
import { useGarage, vehicleShortLabel } from "@/lib/garage-context";

/**
 * Per-line fitment status in cart/review against the active vehicle.
 * Renders nothing when no vehicle is selected or data isn't available —
 * absence of a badge never blocks checkout, it just stops pretending.
 */
export function CartLineFitment({ partId }: { partId?: string }) {
  const { activeVehicle, ready } = useGarage();
  const state = usePartFitment(partId, ready ? activeVehicle?.configId : null);

  if (!activeVehicle || !state) return null;

  return (
    <FitmentBadge
      state={state}
      size="sm"
      vehicleName={state === "verified" || state === "check" ? vehicleShortLabel(activeVehicle) : null}
    />
  );
}
