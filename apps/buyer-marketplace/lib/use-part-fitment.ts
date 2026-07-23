"use client";

import { useEffect, useState } from "react";
import { fitmentForConfig, type FitmentState } from "./fitment";
import { fetchLivePart } from "./live-part";

/**
 * Lazily evaluates a part's fitment against a vehicle configuration by
 * fetching the part detail (which carries full fitment relations). Results
 * are cached per part id for the session — cart lines and review steps reuse
 * the same lookup without refetching.
 */

export function usePartFitment(
  partId: string | undefined,
  configId: string | null | undefined,
): FitmentState | null {
  const [state, setState] = useState<FitmentState | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!partId || !configId) {
      setState(null);
      return;
    }
    fetchLivePart(partId).then((part) => {
      if (cancelled) return;
      setState(part ? fitmentForConfig(part, configId) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [partId, configId]);

  return state;
}
