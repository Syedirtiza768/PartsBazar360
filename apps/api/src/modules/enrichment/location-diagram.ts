/**
 * Generates a supplemental listing image (OEM callout highlight or illustrative
 * location guide) via OpenRouter image models, then writes the PNG to the
 * shared enrichment media directory for the API to serve.
 */

import { mkdir, writeFile, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { OpenRouterClient } from '../listing-pipeline/openrouter-client';
import { MODELS } from '../listing-pipeline/model-registry';
import type { ModelConfig } from '../listing-pipeline/types';
import {
  buildLocationDiagramPrompt,
  isManualReviewResponse,
  type LocationDiagramListingData,
  type LocationDiagramMode,
} from './location-diagram-prompt';
import { DEFAULT_INFOGRAPHIC_MIN_PRICE_USD } from './infographic-spec';

const logger = new Logger('LocationDiagram');

/** Bump when the prompt or storage contract changes. */
export const LOCATION_DIAGRAM_VERSION = 1;

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';
const FALLBACK_MODEL = 'google/gemini-2.5-flash-preview-image';

export function locationDiagramMinPriceUsd(): number {
  const raw = Number(
    process.env.LOCATION_DIAGRAM_MIN_PRICE_USD ||
      process.env.INFOGRAPHIC_MIN_PRICE_USD ||
      '',
  );
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_INFOGRAPHIC_MIN_PRICE_USD;
}

export function enrichmentMediaDir(): string {
  return process.env.ENRICHMENT_MEDIA_DIR || '/app/data/enrichment';
}

export function locationDiagramFilePath(partId: string): string {
  return join(enrichmentMediaDir(), `${partId}.location-diagram.png`);
}

export function locationDiagramPublicUrl(partId: string): string {
  return `/api/search/parts/${partId}/location-diagram.png`;
}

function resolveModel(): ModelConfig {
  const id =
    process.env.LOCATION_DIAGRAM_MODEL ||
    process.env.ENRICHMENT_IMAGE_MODEL ||
    DEFAULT_MODEL;
  return (
    MODELS[id] ||
    MODELS[FALLBACK_MODEL] ||
    MODELS[DEFAULT_MODEL] || {
      id,
      name: id,
      provider: 'OpenRouter',
      inputCostPer1M: 0.3,
      outputCostPer1M: 2.5,
      supportsImageInput: true,
      supportsImageOutput: true,
      supportsTools: false,
      supportsStructuredOutput: false,
      contextWindow: 32_768,
      strengths: [],
      weaknesses: [],
      avgLatencyMs: 5000,
      reliabilityScore: 0.75,
    }
  );
}

export interface LocationDiagramSource {
  mode: LocationDiagramMode;
  /** Absolute or publicly reachable URL / data URL for the reference image. */
  referenceImageUrl: string;
}

/**
 * Prefer an OEM diagram + callout when both are available; otherwise fall back
 * to a seller photo for the illustrative location-guide path.
 */
export function resolveLocationDiagramSource(input: {
  media?: Array<{ url: string; mediaType?: string | null }>;
  imageUrls?: string[];
  calloutNumber?: string | null;
}): LocationDiagramSource | null {
  const callout = (input.calloutNumber || '').trim();
  const media = input.media || [];
  const diagram = media.find((m) => {
    const type = (m.mediaType || '').toUpperCase();
    if (type === 'DIAGRAM' || type === 'OEM_DIAGRAM') return true;
    const url = (m.url || '').toLowerCase();
    return url.includes('diagram') || url.includes('exploded');
  });

  if (diagram?.url && callout) {
    return { mode: 'oem_callout', referenceImageUrl: diagram.url };
  }

  const photo =
    media.find((m) => {
      const type = (m.mediaType || 'IMAGE').toUpperCase();
      return type === 'IMAGE' || type === 'PHOTO';
    })?.url ||
    input.imageUrls?.find((u) => typeof u === 'string' && u.length > 0) ||
    null;

  if (!photo) return null;
  return { mode: 'location_guide', referenceImageUrl: photo };
}

export function buildListingDataFromPart(input: {
  title: string;
  partName?: string | null;
  oemPartNumber?: string | null;
  calloutNumber?: string | null;
  year?: string | number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  engine?: string | null;
  partPosition?: string | null;
  quantityIncluded?: number | null;
  otherIncluded?: string | null;
}): LocationDiagramListingData {
  return {
    listingTitle: input.title,
    partName: input.partName || input.title,
    oemPartNumber: input.oemPartNumber || 'Not verified',
    targetCalloutNumber: (input.calloutNumber || '').trim(),
    year: input.year != null ? String(input.year) : '',
    make: input.make || '',
    model: input.model || '',
    trimOrChassis: input.trim || 'Not specified',
    engine: input.engine || 'Not specified',
    partPosition: input.partPosition || 'Not specified',
    quantityIncluded: Math.max(1, Number(input.quantityIncluded) || 1),
    otherIncludedComponents: input.otherIncluded || 'None',
  };
}

export interface LocationDiagramResult {
  filePath: string;
  publicUrl: string;
  mode: LocationDiagramMode;
  modelId: string;
  costUsd: number;
  version: number;
}

function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

export async function generateLocationDiagram(
  client: OpenRouterClient,
  opts: {
    partId: string;
    source: LocationDiagramSource;
    listing: LocationDiagramListingData;
  },
): Promise<LocationDiagramResult | null> {
  if (
    opts.source.mode === 'oem_callout' &&
    !opts.listing.targetCalloutNumber
  ) {
    return null;
  }

  const { prompt, negativePrompt } = buildLocationDiagramPrompt(
    opts.source.mode,
    opts.listing,
  );
  const model = resolveModel();

  const userContent = [
    { type: 'text' as const, text: `${prompt}\n\nNegative prompt:\n${negativePrompt}` },
    {
      type: 'image_url' as const,
      image_url: { url: opts.source.referenceImageUrl, detail: 'high' as const },
    },
  ];

  try {
    const result = await client.callImage({
      model,
      stage: 'image_generation',
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 4096,
      maxRetries: 1,
      imageConfig: { aspect_ratio: '1:1' },
    });

    if (isManualReviewResponse(result.content)) {
      logger.log(
        `Location diagram deferred for ${opts.partId}: manual review required`,
      );
      return null;
    }

    if (!result.imageDataUrl) {
      logger.warn(`No image returned for location diagram ${opts.partId}`);
      return null;
    }

    const png = decodeDataUrl(result.imageDataUrl);
    if (!png || png.length < 100) {
      logger.warn(`Invalid image payload for location diagram ${opts.partId}`);
      return null;
    }

    const dir = enrichmentMediaDir();
    await mkdir(dir, { recursive: true });
    const filePath = locationDiagramFilePath(opts.partId);
    await writeFile(filePath, png);

    return {
      filePath,
      publicUrl: locationDiagramPublicUrl(opts.partId),
      mode: opts.source.mode,
      modelId: model.id,
      costUsd: result.usage.estimatedCostUsd,
      version: LOCATION_DIAGRAM_VERSION,
    };
  } catch (err) {
    logger.warn(
      `Location diagram failed for ${opts.partId}: ${(err as Error).message}`,
    );
    return null;
  }
}

export async function locationDiagramExists(partId: string): Promise<boolean> {
  try {
    await access(locationDiagramFilePath(partId), fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
