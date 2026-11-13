"use client";

import { useEffect, useState } from "react";
import { type FitmentState, type FitmentVehicleHint } from "./fitment";
import { API_BASE_URL } from "./api";

/**
 * Reads the API's authoritative fitment decision for this part/configuration.
 * The browser must not promote compatibility-table YMM matches to confirmed.
 */

export function usePartFitment(
  partId: string | undefined,
  configId: string | null | undefined,
  vehicle?: FitmentVehicleHint | null,
): FitmentState | null {
  const [state, setState] = useState<FitmentState | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!partId || !configId) {
      setState(null);
      return;
    }
    // A vehicle change must never retain the previous vehicle's green result
    // while the new server-side decision is in flight.
    setState(null);
    const query = new URLSearchParams({ partId, vehicleConfigId: configId });
    fetch(`${API_BASE_URL}/fitment/check?${query.toString()}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Fitment check failed");
        const result = (await response.json()) as { status?: string };
        const states: Record<string, FitmentState> = {
          CONFIRMED: "verified",
          LIKELY: "likely",
          OEM_NUMBER_MATCH: "check",
          DETAILS_REQUIRED: "check",
          NOT_VERIFIED: "check",
          DOES_NOT_FIT: "incompatible",
          UNIVERSAL: "universal",
        };
        if (!cancelled) setState(states[result.status || ""] || "unknown");
      })
      .catch(() => {
        if (!cancelled) setState("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [
    partId,
    configId,
    vehicle?.makeName,
    vehicle?.modelName,
    vehicle?.startYear,
    vehicle?.endYear,
  ]);

  return state;
}
