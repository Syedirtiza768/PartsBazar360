/**
 * Generates the *content* of a high-value part's infographic.
 *
 * Deliberately separate from rendering: the model produces judgement (which
 * facts matter, how to phrase them) while the renderer owns layout. Storing the
 * spec instead of a rendered image means a redesign is a deploy, not a re-render
 * of the catalogue, and never costs a second LLM call.
 */

import { Logger } from '@nestjs/common';
import { OpenRouterClient } from '../listing-pipeline/openrouter-client';
import { MODELS } from '../listing-pipeline/model-registry';
import type { ModelConfig } from '../listing-pipeline/types';

const logger = new Logger('InfographicSpec');

/** Bump only when the spec *shape* changes; visual tweaks do not need this. */
export const INFOGRAPHIC_VERSION = 1;

/** Only parts at or above this price get an infographic. */
export const DEFAULT_INFOGRAPHIC_MIN_PRICE_USD = 300;

const DEFAULT_MODEL = 'openai/gpt-4.1-mini';

/**
 * Layout budgets. The renderer truncates too, but tight input looks better.
 * Few rows set large beats many rows set small: the card is read at a glance
 * next to the photos, not studied.
 */
export const LIMITS = {
  headline: 58,
  subheadline: 76,
  specLabel: 18,
  specValue: 26,
  highlight: 44,
  badge: 14,
  maxSpecs: 4,
  maxHighlights: 3,
} as const;

export interface InfographicSpecField {
  label: string;
  value: string;
}

export interface InfographicSpec {
  headline: string;
  subheadline?: string;
  badge?: string;
  specs: InfographicSpecField[];
  highlights: string[];
}

export interface InfographicInput {
  title: string;
  brand?: string | null;
  category?: string | null;
  partSource?: string | null;
  qualityTier?: string | null;
  manufacturerPartNumber?: string | null;
  oeNumbers?: string[];
  material?: string | null;
  position?: string | null;
  itemSpecifics?: unknown;
  weightKg?: number | null;
  fitmentSummary?: string | null;
}

const RESPONSE_SCHEMA = {
  name: 'part_infographic',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'subheadline', 'badge', 'specs', 'highlights'],
    properties: {
      headline: {
        type: 'string',
        description: `Product name, at most ${LIMITS.headline} characters. No marketing fluff.`,
      },
      subheadline: {
        type: 'string',
        description: `Fitment or context line, at most ${LIMITS.subheadline} characters. Empty string if unknown.`,
      },
      badge: {
        type: 'string',
        description: `Short tag such as OEM, Genuine, or Remanufactured. At most ${LIMITS.badge} characters. Empty string if unclear.`,
      },
      specs: {
        type: 'array',
        minItems: 3,
        maxItems: LIMITS.maxSpecs,
        description:
          'The most decision-relevant spec rows, drawn only from the supplied ' +
          'data. Prefer part number, position, condition and material.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value'],
          properties: {
            label: { type: 'string' },
            value: { type: 'string' },
          },
        },
      },
      highlights: {
        type: 'array',
        minItems: 1,
        maxItems: LIMITS.maxHighlights,
        description: 'Short factual buying points, no superlatives.',
        items: { type: 'string' },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = [
  'You write the content of a specification card shown on an automotive parts',
  'marketplace product page, next to the seller photos.',
  '',
  'Rules that matter more than style:',
  '- Use ONLY facts present in the supplied data. Never invent a number,',
  '  a material, a warranty, or a vehicle fitment.',
  '- If you cannot fill a field honestly, return an empty string for it.',
  '- No superlatives, no "premium quality", no "best value", no exclamation marks.',
  '- Buyers are mechanics and trade buyers. Be terse and technical.',
  '- Specs must be concrete rows a buyer could verify (Part Number, Material,',
  '  Position, Condition, Weight). Skip anything you were not given.',
  `- Give at most ${LIMITS.maxSpecs} spec rows. Choose the ones that decide a`,
  '  purchase, not every field you were handed.',
  '- Highlights are short factual statements, not slogans.',
].join('\n');

function buildUserPrompt(input: InfographicInput): string {
  const lines: string[] = [`Title: ${input.title}`];
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    lines.push(`${label}: ${String(value)}`);
  };

  push('Brand', input.brand);
  push('Category', input.category);
  push('Sourcing', input.partSource);
  push('Condition', input.qualityTier);
  push('Manufacturer part number', input.manufacturerPartNumber);
  push('Material', input.material);
  push('Position', input.position);
  push('Fitment', input.fitmentSummary);
  if (typeof input.weightKg === 'number' && input.weightKg > 0) {
    push('Shipping weight', `${input.weightKg} kg`);
  }
  if (input.oeNumbers?.length) {
    push('OE numbers', input.oeNumbers.slice(0, 8).join(', '));
  }
  if (input.itemSpecifics && typeof input.itemSpecifics === 'object') {
    const entries = Object.entries(input.itemSpecifics as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .slice(0, 20);
    if (entries.length) {
      lines.push('Item specifics:');
      for (const [k, v] of entries) lines.push(`  - ${k}: ${String(v).slice(0, 80)}`);
    }
  }

  return lines.join('\n');
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // Collapse whitespace so the renderer's character budgets are meaningful.
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? normalized.slice(0, max).trimEnd() : normalized;
}

/**
 * Coerces model output into a spec the renderer can trust, or returns null.
 * A card with two rows looks broken, so a spec that thin is rejected outright.
 */
export function normalizeSpec(raw: unknown): InfographicSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const headline = clean(obj.headline, LIMITS.headline);
  if (!headline) return null;

  const specs = Array.isArray(obj.specs)
    ? obj.specs
        .map((entry) => {
          const row = (entry ?? {}) as Record<string, unknown>;
          return {
            label: clean(row.label, LIMITS.specLabel),
            value: clean(row.value, LIMITS.specValue),
          };
        })
        .filter((row) => row.label && row.value)
        .slice(0, LIMITS.maxSpecs)
    : [];

  const highlights = Array.isArray(obj.highlights)
    ? obj.highlights
        .map((entry) => clean(entry, LIMITS.highlight))
        .filter(Boolean)
        .slice(0, LIMITS.maxHighlights)
    : [];

  if (specs.length < 3) return null;

  const subheadline = clean(obj.subheadline, LIMITS.subheadline);
  const badge = clean(obj.badge, LIMITS.badge);

  return {
    headline,
    ...(subheadline ? { subheadline } : {}),
    ...(badge ? { badge } : {}),
    specs,
    highlights,
  };
}

export function infographicMinPriceUsd(): number {
  const raw = Number.parseFloat(
    process.env.INFOGRAPHIC_MIN_PRICE_USD || '',
  );
  return Number.isFinite(raw) && raw >= 0
    ? raw
    : DEFAULT_INFOGRAPHIC_MIN_PRICE_USD;
}

export interface InfographicResult {
  spec: InfographicSpec;
  modelId: string;
  costUsd: number;
}

/** Returns null when the model could not produce a usable card. */
export async function generateInfographicSpec(
  client: OpenRouterClient,
  input: InfographicInput,
): Promise<InfographicResult | null> {
  const model: ModelConfig =
    MODELS[process.env.INFOGRAPHIC_MODEL || ''] || MODELS[DEFAULT_MODEL];

  try {
    const result = await client.call({
      model,
      stage: 'item_specifics',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      temperature: 0.2,
      maxTokens: 900,
      responseFormat: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
      maxRetries: 1,
    });

    const spec = normalizeSpec(OpenRouterClient.extractJson(result.content));
    if (!spec) {
      logger.warn(`${model.id} produced an unusable infographic spec`);
      return null;
    }

    return {
      spec,
      modelId: model.id,
      costUsd: result.usage.estimatedCostUsd,
    };
  } catch (err: any) {
    logger.warn(`Infographic spec failed: ${err?.message || err}`);
    return null;
  }
}
