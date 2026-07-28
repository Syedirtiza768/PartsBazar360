/**
 * AI estimation of shipping weight and packed dimensions for a part.
 *
 * This is the last resort in the weight hierarchy, below seller spreadsheets and
 * above the part-class median. Because a wrong weight becomes a wrong price, the
 * model's answer is never trusted as-is: it is validated against the part-class
 * envelope, and anything implausible is rejected so the caller falls back to the
 * class default rather than quoting a hallucinated number.
 */

import { Logger } from '@nestjs/common';
import { OpenRouterClient } from '../listing-pipeline/openrouter-client';
import { MODELS } from '../listing-pipeline/model-registry';
import type { ModelConfig } from '../listing-pipeline/types';
import {
  clampWeightToClass,
  getPartClassProfile,
  type PartClassProfile,
} from '../checkout/part-class-weights';
import type { DimensionsCm } from '../checkout/billable-weight.util';

const logger = new Logger('WeightEstimator');

/** Cheap and strong enough for a single-fact numeric extraction. */
const DEFAULT_PRIMARY_MODEL = 'google/gemini-2.5-flash';
/** Used only when the primary answer fails validation or is low confidence. */
const DEFAULT_ESCALATION_MODEL = 'openai/gpt-4.1-mini';

/** Below this the primary answer is escalated rather than accepted. */
const ESCALATION_CONFIDENCE_THRESHOLD = 0.6;
/** Below this even an escalated answer is discarded for the class default. */
const MIN_ACCEPTABLE_CONFIDENCE = 0.45;

export interface WeightEstimateInput {
  title: string;
  brand?: string | null;
  category?: string | null;
  partClassKey: string;
  oeNumbers?: string[];
  manufacturerPartNumber?: string | null;
}

export interface WeightEstimate {
  weightKg: number;
  dimensionsCm: DimensionsCm | null;
  confidence: number;
  reasoning: string;
  modelId: string;
  costUsd: number;
  /** True when the model's weight was pulled back into the class envelope. */
  clamped: boolean;
}

const RESPONSE_SCHEMA = {
  name: 'part_shipping_metrics',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'weightKg',
      'lengthCm',
      'widthCm',
      'heightCm',
      'confidence',
      'reasoning',
    ],
    properties: {
      weightKg: {
        type: 'number',
        description: 'Packed shipping weight of one unit, in kilograms.',
      },
      lengthCm: {
        type: 'number',
        description: 'Longest side of the shipping carton, in centimetres.',
      },
      widthCm: { type: 'number', description: 'Carton width in centimetres.' },
      heightCm: { type: 'number', description: 'Carton height in centimetres.' },
      confidence: {
        type: 'number',
        description:
          'How confident you are, 0 to 1. Use below 0.5 if the part is ambiguous.',
      },
      reasoning: {
        type: 'string',
        description: 'One short sentence explaining the estimate.',
      },
    },
  },
} as const;

function buildSystemPrompt(profile: PartClassProfile): string {
  return [
    'You estimate shipping weights and packed carton dimensions for automotive parts.',
    'You are given a part listing. Return the weight of ONE unit as it would be',
    'packed and handed to a courier — including packaging, not just the bare part.',
    '',
    `This part was classified as "${profile.key}". Parts in this class typically`,
    `weigh about ${profile.medianWeightKg}kg and realistically range from`,
    `${profile.minWeightKg}kg to ${profile.maxWeightKg}kg. Typical carton is about`,
    `${profile.typicalDimsCm.l} x ${profile.typicalDimsCm.w} x ${profile.typicalDimsCm.h} cm.`,
    'Treat these as a sanity check: stay inside the range unless the listing',
    'clearly describes something unusual (a set, a pair, or an assembly).',
    '',
    'Rules:',
    '- Use metric units only: kilograms and centimetres.',
    '- If the title implies a set or pair, give the weight for the whole set.',
    '- Dimensions describe the outer carton, so allow for packaging.',
    '- Be honest with confidence. A generic title deserves a low score.',
  ].join('\n');
}

function buildUserPrompt(input: WeightEstimateInput): string {
  const lines = [`Title: ${input.title}`];
  if (input.brand) lines.push(`Brand: ${input.brand}`);
  if (input.category) lines.push(`Category: ${input.category}`);
  if (input.manufacturerPartNumber) {
    lines.push(`Part number: ${input.manufacturerPartNumber}`);
  }
  if (input.oeNumbers?.length) {
    lines.push(`OE numbers: ${input.oeNumbers.slice(0, 6).join(', ')}`);
  }
  return lines.join('\n');
}

interface RawEstimate {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  confidence: number;
  reasoning: string;
}

function parseEstimate(content: string): RawEstimate | null {
  try {
    const parsed = OpenRouterClient.extractJson(content) as Record<
      string,
      unknown
    >;
    const weightKg = Number(parsed.weightKg);
    const lengthCm = Number(parsed.lengthCm);
    const widthCm = Number(parsed.widthCm);
    const heightCm = Number(parsed.heightCm);
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
    return {
      weightKg,
      lengthCm,
      widthCm,
      heightCm,
      confidence: Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0.5,
      reasoning:
        typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 300) : '',
    };
  } catch {
    return null;
  }
}

/**
 * Rejects answers that are outside the class envelope by more than an order of
 * magnitude. A modest overshoot is clamped, but a 100x error means the model
 * misunderstood the part and its dimensions cannot be trusted either.
 */
const HARD_REJECT_FACTOR = 10;

function validate(
  raw: RawEstimate,
  profile: PartClassProfile,
): { weightKg: number; dimensionsCm: DimensionsCm | null; clamped: boolean } | null {
  if (
    raw.weightKg > profile.maxWeightKg * HARD_REJECT_FACTOR ||
    raw.weightKg < profile.minWeightKg / HARD_REJECT_FACTOR
  ) {
    return null;
  }

  const { kg, clamped } = clampWeightToClass(raw.weightKg, profile);

  const dimsValid =
    Number.isFinite(raw.lengthCm) &&
    Number.isFinite(raw.widthCm) &&
    Number.isFinite(raw.heightCm) &&
    raw.lengthCm > 0 &&
    raw.widthCm > 0 &&
    raw.heightCm > 0 &&
    // A single part over 6m in any direction is a unit error, not a real carton.
    Math.max(raw.lengthCm, raw.widthCm, raw.heightCm) <= 600;

  return {
    weightKg: kg,
    dimensionsCm: dimsValid
      ? {
          lengthCm: round(raw.lengthCm, 1),
          widthCm: round(raw.widthCm, 1),
          heightCm: round(raw.heightCm, 1),
        }
      : null,
    clamped,
  };
}

function resolveModel(envVar: string, fallbackId: string): ModelConfig {
  const requested = process.env[envVar];
  return MODELS[requested || ''] || MODELS[fallbackId];
}

/**
 * Estimates weight and dimensions, escalating to a stronger model once if the
 * first answer is unusable or low confidence. Returns null when no attempt
 * produced a trustworthy answer, so the caller keeps the class default.
 */
export async function estimateWeight(
  client: OpenRouterClient,
  input: WeightEstimateInput,
): Promise<WeightEstimate | null> {
  const profile = getPartClassProfile(input.partClassKey);
  const messages = [
    { role: 'system' as const, content: buildSystemPrompt(profile) },
    { role: 'user' as const, content: buildUserPrompt(input) },
  ];

  const attempts: ModelConfig[] = [
    resolveModel('ENRICHMENT_WEIGHT_MODEL', DEFAULT_PRIMARY_MODEL),
    resolveModel('ENRICHMENT_ESCALATION_MODEL', DEFAULT_ESCALATION_MODEL),
  ];

  let lastCost = 0;

  for (const [index, model] of attempts.entries()) {
    const isFinalAttempt = index === attempts.length - 1;
    try {
      const result = await client.call({
        model,
        stage: 'item_specifics',
        messages,
        temperature: 0,
        maxTokens: 512,
        responseFormat: {
          type: 'json_schema',
          json_schema: RESPONSE_SCHEMA,
        },
        maxRetries: 1,
      });
      lastCost += result.usage.estimatedCostUsd;

      const raw = parseEstimate(result.content);
      if (!raw) {
        logger.warn(`${model.id} returned unparseable weight JSON`);
        continue;
      }

      const validated = validate(raw, profile);
      if (!validated) {
        logger.warn(
          `${model.id} weight ${raw.weightKg}kg is implausible for ${profile.key}`,
        );
        continue;
      }

      // A shaky first answer is worth a second opinion; a shaky last answer is
      // worse than the deterministic class median.
      if (!isFinalAttempt && raw.confidence < ESCALATION_CONFIDENCE_THRESHOLD) {
        continue;
      }
      if (raw.confidence < MIN_ACCEPTABLE_CONFIDENCE) {
        continue;
      }

      return {
        weightKg: validated.weightKg,
        dimensionsCm: validated.dimensionsCm,
        confidence: raw.confidence,
        reasoning: raw.reasoning,
        modelId: model.id,
        costUsd: lastCost,
        clamped: validated.clamped,
      };
    } catch (err: any) {
      logger.warn(`${model.id} weight estimate failed: ${err?.message || err}`);
    }
  }

  return null;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
