"use client";

import { useEffect, useState } from "react";
import {
  fetchEnrichmentSnapshot,
  shouldPollEnrichment,
  type EnrichmentSnapshot,
} from "./enrichment-client";
import type { Part, PartShipping } from "./types";

const POLL_MS = 2_000;
const MAX_POLLS = 45; // ~90s — after that the class estimate stands

export interface ReconciledPartView {
  shipping: PartShipping | null | undefined;
  images: string[];
  enrichmentStatus: string | null;
  refining: boolean;
}

/**
 * Polls the lightweight enrichment endpoint while a better weight / infographic
 * is being computed, then folds the result into the already-rendered PDP.
 *
 * The page never blocks on enrichment: first paint uses the RSC payload, and
 * this hook only upgrades it when a better answer arrives.
 */
export function useEnrichmentReconcile(part: Part): ReconciledPartView {
  const [snapshot, setSnapshot] = useState<EnrichmentSnapshot | null>(null);
  const [refining, setRefining] = useState(() =>
    shouldPollEnrichment(part.enrichmentStatus, part.shipping?.state),
  );

  useEffect(() => {
    if (!shouldPollEnrichment(part.enrichmentStatus, part.shipping?.state)) {
      setRefining(false);
      return;
    }

    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const tick = async () => {
      if (cancelled) return;
      polls += 1;
      const next = await fetchEnrichmentSnapshot(part.id, controller.signal);
      if (cancelled) return;

      if (next) {
        setSnapshot(next);
        const stillGoing = shouldPollEnrichment(
          next.enrichmentStatus,
          next.shipping?.state,
        );
        if (!stillGoing || next.enrichmentStatus === "DONE") {
          setRefining(false);
          return;
        }
      }

      if (polls >= MAX_POLLS) {
        setRefining(false);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [part.id, part.enrichmentStatus, part.shipping?.state]);

  const shipping = snapshot?.shipping ?? part.shipping;
  const images = mergeLeadImages(part.imageUrls || [], [
    snapshot?.locationDiagramUrl ?? part.locationDiagramUrl,
    snapshot?.infographicUrl ?? part.infographicUrl,
  ]);

  return {
    shipping,
    images,
    enrichmentStatus: snapshot?.enrichmentStatus ?? part.enrichmentStatus ?? null,
    refining,
  };
}

function mergeLeadImages(
  images: string[],
  leadUrls: Array<string | null | undefined>,
): string[] {
  let next = images;
  // Apply in reverse so the first lead ends up at index 0.
  for (const url of [...leadUrls].reverse()) {
    if (!url) continue;
    next = [url, ...next.filter((u) => u !== url)];
  }
  return next;
}
