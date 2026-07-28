import type {
  ModelConfig,
  PipelineConfig,
  ConfidenceThresholds,
} from './types';

/**
 * OpenRouter Model Registry — curated for the listing-enrichment pipeline.
 *
 * Prices sourced from https://openrouter.ai/models on 2026-07-27.
 * All costs are USD per 1 million tokens.
 */

// ─── Model Catalog ──────────────────────────────────────────────────────────

export const MODELS: Record<string, ModelConfig> = {
  // ── Budget Vision / OCR ───────────────────────────────────────────────────
  'google/gemini-2.5-flash-lite': {
    id: 'google/gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'Google',
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_048_576,
    strengths: ['Cheapest Gemini vision', '1M context', 'fast', 'good OCR'],
    weaknesses: ['Weaker reasoning', 'less reliable on ambiguous parts'],
    avgLatencyMs: 800,
    reliabilityScore: 0.82,
  },
  'openai/gpt-4.1-nano': {
    id: 'openai/gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    provider: 'OpenAI',
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_048_576,
    strengths: ['Cheapest OpenAI vision', 'reliable JSON', '1M context'],
    weaknesses: ['Weak on complex reasoning', 'limited product knowledge'],
    avgLatencyMs: 600,
    reliabilityScore: 0.85,
  },
  'mistralai/mistral-small-3.2-24b-instruct': {
    id: 'mistralai/mistral-small-3.2-24b-instruct',
    name: 'Mistral Small 3.2',
    provider: 'Mistral',
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.3,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 262_144,
    strengths: ['Very cheap', 'vision+tools', 'fast'],
    weaknesses: ['Smaller model', 'less automotive knowledge'],
    avgLatencyMs: 500,
    reliabilityScore: 0.78,
  },
  'openai/gpt-4.1-mini': {
    id: 'openai/gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'OpenAI',
    inputCostPer1M: 0.4,
    outputCostPer1M: 1.6,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_048_576,
    strengths: [
      'Best cost/reliability ratio',
      'excellent structured output',
      'strong OCR',
      '1M context',
    ],
    weaknesses: ['Not as strong on deep reasoning as larger models'],
    avgLatencyMs: 900,
    reliabilityScore: 0.92,
  },
  'google/gemini-2.5-flash': {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_048_576,
    strengths: [
      'Great value reasoning',
      'vision',
      '1M context',
      'good automotive knowledge',
    ],
    weaknesses: ['JSON occasionally has trailing commas'],
    avgLatencyMs: 1100,
    reliabilityScore: 0.9,
  },
  'qwen/qwen2.5-vl-72b-instruct': {
    id: 'qwen/qwen2.5-vl-72b-instruct',
    name: 'Qwen 2.5 VL 72B',
    provider: 'Qwen',
    inputCostPer1M: 0.8,
    outputCostPer1M: 1.0,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: false,
    supportsStructuredOutput: false,
    contextWindow: 131_072,
    strengths: [
      'Excellent OCR',
      'strong on part number extraction',
      'good multilingual',
    ],
    weaknesses: ['No tool calling', 'weaker structured output'],
    avgLatencyMs: 1500,
    reliabilityScore: 0.87,
  },

  // ── Mid-Tier Reasoning ────────────────────────────────────────────────────
  'xiaomi/mimo-v2.5-pro': {
    id: 'xiaomi/mimo-v2.5-pro',
    name: 'MiMo v2.5 Pro',
    provider: 'Xiaomi',
    inputCostPer1M: 0.44,
    outputCostPer1M: 0.87,
    supportsImageInput: false,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_050_000,
    strengths: [
      'Cheapest reasoning model',
      '1M context',
      'good automotive knowledge',
      'already proven in enrich-itemspecifics.mjs',
    ],
    weaknesses: [
      'No vision',
      'reasoning tokens increase cost',
      'longer latency',
    ],
    avgLatencyMs: 3000,
    reliabilityScore: 0.88,
  },
  'openai/gpt-4.1': {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    inputCostPer1M: 2.0,
    outputCostPer1M: 8.0,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_048_576,
    strengths: [
      'Most reliable JSON output',
      'strong vision',
      'excellent structured output',
    ],
    weaknesses: ['Expensive for bulk processing'],
    avgLatencyMs: 1200,
    reliabilityScore: 0.96,
  },
  'openai/o4-mini': {
    id: 'openai/o4-mini',
    name: 'o4-mini',
    provider: 'OpenAI',
    inputCostPer1M: 1.1,
    outputCostPer1M: 4.4,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 200_000,
    strengths: ['Deep reasoning', 'good at complex fitment analysis', 'vision'],
    weaknesses: ['Smaller context window', 'reasoning tokens add cost'],
    avgLatencyMs: 4000,
    reliabilityScore: 0.93,
  },
  'google/gemini-2.5-pro': {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_048_576,
    strengths: [
      'Best reasoning per dollar',
      '1M context',
      'strong product identification',
      'vision',
    ],
    weaknesses: ['Higher output cost', 'occasional JSON issues'],
    avgLatencyMs: 2000,
    reliabilityScore: 0.94,
  },
  'anthropic/claude-sonnet-4': {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_000_000,
    strengths: [
      'Excellent structured output',
      'best hallucination resistance',
      'strong automotive knowledge',
    ],
    weaknesses: ['Expensive', 'slower than alternatives'],
    avgLatencyMs: 2500,
    reliabilityScore: 0.97,
  },

  // ── Premium ───────────────────────────────────────────────────────────────
  'anthropic/claude-opus-4.5': {
    id: 'anthropic/claude-opus-4.5',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    inputCostPer1M: 5.0,
    outputCostPer1M: 25.0,
    supportsImageInput: true,
    supportsImageOutput: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_000_000,
    strengths: [
      'Best hallucination detection',
      'deep reasoning',
      'excellent for validation',
    ],
    weaknesses: ['Very expensive', 'slow'],
    avgLatencyMs: 5000,
    reliabilityScore: 0.99,
  },

  // ── Image Generation ──────────────────────────────────────────────────────
  'google/gemini-2.5-flash-image': {
    id: 'google/gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    provider: 'Google',
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
    supportsImageInput: true,
    supportsImageOutput: true,
    supportsTools: false,
    supportsStructuredOutput: false,
    contextWindow: 32_768,
    strengths: ['Image generation', 'image-to-image editing', 'fast'],
    weaknesses: [
      'Lower quality than premium',
      'limited text rendering in images',
    ],
    avgLatencyMs: 5000,
    reliabilityScore: 0.78,
  },
  'google/gemini-2.5-flash-preview-image': {
    id: 'google/gemini-2.5-flash-preview-image',
    name: 'Gemini 2.5 Flash Image (preview id)',
    provider: 'Google',
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
    supportsImageInput: true,
    supportsImageOutput: true,
    supportsTools: false,
    supportsStructuredOutput: false,
    contextWindow: 32_768,
    strengths: ['Cheapest image generation', 'image-to-image editing', 'fast'],
    weaknesses: [
      'Lower quality than premium',
      'limited text rendering in images',
    ],
    avgLatencyMs: 5000,
    reliabilityScore: 0.75,
  },
  'google/gemini-2.0-flash-preview-image': {
    id: 'google/gemini-2.0-flash-preview-image',
    name: 'Gemini 2.0 Flash Image',
    provider: 'Google',
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    supportsImageInput: true,
    supportsImageOutput: true,
    supportsTools: false,
    supportsStructuredOutput: false,
    contextWindow: 32_768,
    strengths: ['Ultra cheap image gen', 'image editing'],
    weaknesses: ['Lower quality', 'may distort product details'],
    avgLatencyMs: 4000,
    reliabilityScore: 0.65,
  },
  'openai/gpt-image-1': {
    id: 'openai/gpt-image-1',
    name: 'GPT Image 1',
    provider: 'OpenAI',
    inputCostPer1M: 5.0,
    outputCostPer1M: 10.0,
    supportsImageInput: true,
    supportsImageOutput: true,
    supportsTools: false,
    supportsStructuredOutput: false,
    contextWindow: 32_768,
    strengths: [
      'High quality image generation',
      'excellent text rendering',
      'good annotation style',
    ],
    weaknesses: ['Expensive', 'slower'],
    avgLatencyMs: 8000,
    reliabilityScore: 0.85,
  },
};

// ─── Pipeline Configurations ────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  autoPublish: 0.9,
  publishWithWarning: 0.75,
  secondaryReview: 0.5,
  humanReview: 0.3,
  reject: 0.0,
};

export const PIPELINE_CONFIGS: Record<string, PipelineConfig> = {
  budget: {
    name: 'budget',
    stages: {
      input_analysis: MODELS['openai/gpt-4.1-nano'],
      image_extraction: MODELS['google/gemini-2.5-flash-lite'],
      product_identification: MODELS['openai/gpt-4.1-nano'],
      item_specifics: MODELS['openai/gpt-4.1-nano'],
      compatibility: MODELS['openai/gpt-4.1-nano'],
      diagram_prompt: MODELS['openai/gpt-4.1-nano'],
      image_generation: MODELS['google/gemini-2.0-flash-preview-image'],
      title_description: MODELS['openai/gpt-4.1-nano'],
      validation: MODELS['openai/gpt-4.1-nano'],
      quality_control: MODELS['openai/gpt-4.1-nano'],
    },
    maxRetries: 2,
    confidenceThresholds: {
      autoPublish: 0.85,
      publishWithWarning: 0.65,
      secondaryReview: 0.45,
      humanReview: 0.25,
      reject: 0.0,
    },
  },
  balanced: {
    name: 'balanced',
    stages: {
      input_analysis: MODELS['openai/gpt-4.1-mini'],
      image_extraction: MODELS['openai/gpt-4.1-mini'],
      product_identification: MODELS['openai/gpt-4.1-mini'],
      item_specifics: MODELS['openai/gpt-4.1-mini'],
      compatibility: MODELS['openai/gpt-4.1-mini'],
      diagram_prompt: MODELS['openai/gpt-4.1-mini'],
      image_generation: MODELS['google/gemini-2.5-flash-preview-image'],
      title_description: MODELS['openai/gpt-4.1-mini'],
      validation: MODELS['google/gemini-2.5-flash'],
      quality_control: MODELS['openai/gpt-4.1-mini'],
    },
    maxRetries: 3,
    confidenceThresholds: DEFAULT_THRESHOLDS,
  },
  premium: {
    name: 'premium',
    stages: {
      input_analysis: MODELS['openai/gpt-4.1-mini'],
      image_extraction: MODELS['google/gemini-2.5-pro'],
      product_identification: MODELS['google/gemini-2.5-pro'],
      item_specifics: MODELS['anthropic/claude-sonnet-4'],
      compatibility: MODELS['anthropic/claude-sonnet-4'],
      diagram_prompt: MODELS['anthropic/claude-sonnet-4'],
      image_generation: MODELS['openai/gpt-image-1'],
      title_description: MODELS['anthropic/claude-sonnet-4'],
      validation: MODELS['anthropic/claude-sonnet-4'],
      quality_control: MODELS['anthropic/claude-opus-4.5'],
    },
    maxRetries: 3,
    confidenceThresholds: {
      autoPublish: 0.95,
      publishWithWarning: 0.8,
      secondaryReview: 0.6,
      humanReview: 0.4,
      reject: 0.0,
    },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getModel(modelId: string): ModelConfig {
  const model = MODELS[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  return model;
}

export function getPipelineConfig(name: string): PipelineConfig {
  const config = PIPELINE_CONFIGS[name];
  if (!config)
    throw new Error(
      `Unknown pipeline config: ${name}. Use: budget, balanced, premium`,
    );
  return config;
}

export function estimateCost(
  model: ModelConfig,
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens * model.inputCostPer1M) / 1_000_000 +
    (outputTokens * model.outputCostPer1M) / 1_000_000
  );
}
