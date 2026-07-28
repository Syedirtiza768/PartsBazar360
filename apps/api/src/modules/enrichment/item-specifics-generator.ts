/**
 * Generates marketplace item specifics during background enrichment.
 *
 * Reuses the listing-pipeline prompts so PDP specs stay consistent with the
 * seller listing flow. Stores a flat camelCase object (what the buyer UI
 * expects) and extracts a few high-signal columns onto CanonicalPart.
 */

import { Logger } from '@nestjs/common';
import { OpenRouterClient } from '../listing-pipeline/openrouter-client';
import { MODELS } from '../listing-pipeline/model-registry';
import type { ModelConfig } from '../listing-pipeline/types';
import {
  buildItemSpecificsSystemPrompt,
  buildItemSpecificsUserPrompt,
} from '../listing-pipeline/prompts/item-specifics';

const logger = new Logger('ItemSpecificsGenerator');

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

/** Maps human-readable listing-pipeline field names → camelCase keys. */
export const ITEM_SPECIFIC_FIELD_TO_KEY: Record<string, string> = {
  Brand: 'brandType',
  MPN: 'mpn',
  'Manufacturer Part Number': 'mpn',
  'Manufacturer Part Number (MPN)': 'mpn',
  'OE Number': 'oeNumber',
  'OE Numbers': 'OE_numbers',
  'OE/OEM Part Number': 'oeNumber',
  Condition: 'condition',
  'Brand Type': 'brandType',
  Warranty: 'warranty',
  'Manufacturer Warranty': 'warranty',
  Placement: 'placementOnVehicle',
  'Placement on Vehicle': 'placementOnVehicle',
  Position: 'position',
  Material: 'material',
  Color: 'color',
  'Part Type': 'partType',
  'Product Type': 'partType',
  'Product Type / Part Type': 'partType',
  'Surface Finish': 'surfaceFinish',
  Finish: 'surfaceFinish',
  'Country of Origin': 'countryOfOrigin',
  'Country/Region of Manufacture': 'countryOfOrigin',
  'Category Type': 'categoryType',
  Features: 'features',
  'Fitment Type': 'fitmentType',
  'Compatible Vehicles': 'compatibleVehicles',
  'Vehicle System': 'vehicleSystem',
  'Diagram Callout': 'diagramCallout',
  'Diagram Callout Number': 'diagramCallout',
  'Callout Number': 'diagramCallout',
  'Part Position': 'partPosition',
  Quantity: 'quantityIncluded',
  'Unit Quantity': 'quantityIncluded',
};

export interface ItemSpecificFieldRow {
  field: string;
  value: unknown;
  normalizedValue?: unknown;
  autoPublish?: boolean;
  confidence?: number;
  verificationStatus?: string;
}

export interface ItemSpecificsInput {
  title: string;
  brand?: string | null;
  manufacturerPartNumber?: string | null;
  oeNumbers?: string[];
  category?: string | null;
  condition?: string | null;
  description?: string | null;
  partSource?: string | null;
  qualityTier?: string | null;
  compatibility?: Array<Record<string, unknown>>;
}

export interface ItemSpecificsResult {
  /** Flat object for CanonicalPart.itemSpecifics / PDP. */
  flat: Record<string, unknown>;
  /** Raw array form for downstream diagram prompting. */
  fields: ItemSpecificFieldRow[];
  position: string | null;
  material: string | null;
  vehicleSystem: string | null;
  modelId: string;
  costUsd: number;
}

function resolveModel(): ModelConfig {
  const id = process.env.ENRICHMENT_ITEM_SPECIFICS_MODEL || DEFAULT_MODEL;
  return (
    MODELS[id] ||
    MODELS[DEFAULT_MODEL] || {
      id,
      name: id,
      provider: 'OpenRouter',
      inputCostPer1M: 0.3,
      outputCostPer1M: 2.5,
      supportsImageInput: false,
      supportsImageOutput: false,
      supportsTools: false,
      supportsStructuredOutput: true,
      contextWindow: 128_000,
      strengths: [],
      weaknesses: [],
      avgLatencyMs: 2000,
      reliabilityScore: 0.8,
    }
  );
}

function fieldKey(field: string): string {
  return (
    ITEM_SPECIFIC_FIELD_TO_KEY[field] ||
    field.charAt(0).toLowerCase() + field.slice(1).replace(/\s+/g, '')
  );
}

/** Flatten listing-pipeline array rows into the PDP map shape. */
export function flattenItemSpecifics(
  fields: ItemSpecificFieldRow[],
  classification?: {
    partType?: string;
    vehicleSystem?: string;
    categoryType?: string;
  },
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const entry of fields) {
    if (!entry?.field || entry.value == null || entry.value === '') continue;
    // Prefer publishable / higher-confidence values when duplicates appear.
    const key = fieldKey(entry.field);
    if (map[key] != null && entry.autoPublish === false) continue;
    map[key] = entry.normalizedValue ?? entry.value;
  }
  if (classification?.partType && map.partType == null) {
    map.partType = classification.partType;
  }
  if (classification?.vehicleSystem && map.vehicleSystem == null) {
    map.vehicleSystem = classification.vehicleSystem;
  }
  if (classification?.categoryType && map.categoryType == null) {
    map.categoryType = classification.categoryType;
  }
  return map;
}

function pickString(
  flat: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const v = flat[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export async function generateItemSpecifics(
  client: OpenRouterClient,
  input: ItemSpecificsInput,
): Promise<ItemSpecificsResult | null> {
  const model = resolveModel();
  const messages = [
    { role: 'system' as const, content: buildItemSpecificsSystemPrompt() },
    {
      role: 'user' as const,
      content: buildItemSpecificsUserPrompt({
        title: input.title,
        brand: input.brand ?? undefined,
        manufacturerPartNumber: input.manufacturerPartNumber ?? undefined,
        oeNumbers: input.oeNumbers,
        category: input.category ?? undefined,
        condition: input.condition ?? undefined,
        description: input.description ?? undefined,
        partSource: input.partSource ?? undefined,
        qualityTier: input.qualityTier ?? undefined,
        compatibility: input.compatibility,
      }),
    },
  ];

  try {
    const result = await client.call({
      model,
      stage: 'item_specifics',
      messages,
      maxTokens: 4096,
      maxRetries: 1,
    });

    const parsed = OpenRouterClient.extractJson(result.content) as {
      itemSpecifics?: ItemSpecificFieldRow[];
      productClassification?: {
        partType?: string;
        vehicleSystem?: string;
        categoryType?: string;
      };
    };

    const fields = Array.isArray(parsed.itemSpecifics)
      ? parsed.itemSpecifics
      : [];
    const flat = flattenItemSpecifics(fields, parsed.productClassification);
    if (Object.keys(flat).length === 0) {
      logger.warn('Item specifics model returned no usable fields');
      return null;
    }

    return {
      flat,
      fields,
      position: pickString(flat, 'position', 'placementOnVehicle', 'partPosition'),
      material: pickString(flat, 'material'),
      vehicleSystem: pickString(flat, 'vehicleSystem'),
      modelId: model.id,
      costUsd: result.usage.estimatedCostUsd,
    };
  } catch (err) {
    logger.warn(
      `Item specifics generation failed: ${(err as Error).message}`,
    );
    return null;
  }
}
