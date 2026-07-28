import { API_BASE_URL } from './api';
import type { PartShipping } from './types';

export interface EnrichmentSnapshot {
  id: string;
  shipping: PartShipping;
  enrichmentStatus: string;
  enrichmentVersion: number;
  enrichedAt: string | null;
  hasItemSpecifics: boolean;
  itemSpecifics?: Record<string, unknown> | null;
  locationDiagramUrl: string | null;
  locationDiagramAlt: string | null;
  infographicUrl: string | null;
  infographicAlt: string | null;
}

const PREWARMED = new Set<string>();
const IN_FLIGHT = new Set(['QUEUED', 'RUNNING']);

/** True when the PDP should keep polling for a better answer. */
export function shouldPollEnrichment(
  status?: string | null,
  shippingState?: PartShipping['state'] | null,
): boolean {
  if (status && IN_FLIGHT.has(status)) return true;
  return shippingState === 'pending';
}

/**
 * Fire-and-forget pre-warm. Deduped per tab so scrolling a results page does
 * not hammer the API with the same ids. Failures are swallowed — the PDP still
 * renders a class estimate if enrichment never runs.
 */
export function prewarmEnrichment(partIds: string[]): void {
  const fresh = partIds.filter((id) => id && !PREWARMED.has(id));
  if (!fresh.length) return;
  for (const id of fresh) PREWARMED.add(id);

  const body = JSON.stringify({ partIds: fresh.slice(0, 12) });
  const url = `${API_BASE_URL}/search/enrichment/prewarm`;

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }

  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export async function fetchEnrichmentSnapshot(
  partId: string,
  signal?: AbortSignal,
): Promise<EnrichmentSnapshot | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/search/parts/${partId}/enrichment`, {
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as EnrichmentSnapshot;
  } catch {
    return null;
  }
}
