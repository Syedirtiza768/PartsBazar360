import type {
  PipelineConfig,
  PipelineStage,
  ModelConfig,
  ListingPipelineInput,
  RoutingDecision,
  ConfidenceThresholds,
} from './types';
import { PIPELINE_CONFIGS, MODELS } from './model-registry';

/**
 * Dynamic model routing service.
 *
 * Instead of sending every listing to the most expensive model, this service
 * routes based on input quality, confidence thresholds, and escalation rules.
 */
export class ModelRouter {
  private config: PipelineConfig;
  private escalationHistory: Map<string, number> = new Map();

  constructor(configName: string = 'balanced') {
    this.config = PIPELINE_CONFIGS[configName] || PIPELINE_CONFIGS.balanced;
  }

  /**
   * Select the model for a given pipeline stage, considering input quality.
   */
  selectModel(
    stage: PipelineStage,
    input: ListingPipelineInput,
    priorConfidence?: number,
  ): ModelConfig {
    const baseModel = this.config.stages[stage];

    // Escalate if prior confidence is low
    if (
      priorConfidence !== undefined &&
      priorConfidence < this.config.confidenceThresholds.secondaryReview
    ) {
      return this.escalate(stage, baseModel);
    }

    // Escalate image extraction when images are likely poor quality
    if (
      stage === 'image_extraction' &&
      (!input.imageUrls || input.imageUrls.length === 0)
    ) {
      return baseModel; // No images, skip escalation
    }

    // Escalate compatibility when we have complex fitment data
    if (stage === 'compatibility' && (input.compatibility?.length ?? 0) > 20) {
      return this.escalate(stage, baseModel);
    }

    // Escalate item_specifics when input data is sparse
    if (stage === 'item_specifics' && this.isSparseInput(input)) {
      return this.escalate(stage, baseModel);
    }

    return baseModel;
  }

  /**
   * Determine routing decision based on overall confidence.
   */
  getRoutingDecision(confidence: number): RoutingDecision {
    const t = this.config.confidenceThresholds;
    if (confidence >= t.autoPublish) return 'auto_publish';
    if (confidence >= t.publishWithWarning) return 'publish_with_warning';
    if (confidence >= t.secondaryReview) return 'secondary_ai_review';
    if (confidence >= t.humanReview) return 'human_review';
    return 'reject';
  }

  /**
   * Should we run a secondary validation pass?
   */
  shouldValidate(confidence: number): boolean {
    return confidence < this.config.confidenceThresholds.publishWithWarning;
  }

  /**
   * Should we skip image generation for this listing?
   */
  shouldSkipImageGeneration(input: ListingPipelineInput): boolean {
    // Skip if no images available
    if (!input.imageUrls || input.imageUrls.length === 0) return true;
    return false;
  }

  /**
   * Get the pipeline configuration.
   */
  getConfig(): PipelineConfig {
    return this.config;
  }

  /**
   * Get confidence thresholds.
   */
  getThresholds(): ConfidenceThresholds {
    return this.config.confidenceThresholds;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private escalate(
    stage: PipelineStage,
    currentModel: ModelConfig,
  ): ModelConfig {
    const escalationOrder = [
      'openai/gpt-4.1-nano',
      'google/gemini-2.5-flash-lite',
      'mistralai/mistral-small-3.2-24b-instruct',
      'openai/gpt-4.1-mini',
      'google/gemini-2.5-flash',
      'openai/gpt-4.1',
      'openai/o4-mini',
      'google/gemini-2.5-pro',
      'anthropic/claude-sonnet-4',
      'anthropic/claude-opus-4.5',
    ];

    const currentIdx = escalationOrder.indexOf(currentModel.id);
    const nextIdx = Math.min(currentIdx + 1, escalationOrder.length - 1);
    const nextModelId = escalationOrder[nextIdx];

    const key = `${stage}:${nextModelId}`;
    const count = this.escalationHistory.get(key) ?? 0;
    this.escalationHistory.set(key, count + 1);

    return MODELS[nextModelId] || currentModel;
  }

  private isSparseInput(input: ListingPipelineInput): boolean {
    let fieldsPresent = 0;
    if (input.title) fieldsPresent++;
    if (input.brand) fieldsPresent++;
    if (input.manufacturerPartNumber) fieldsPresent++;
    if (input.oeNumbers?.length) fieldsPresent++;
    if (input.category) fieldsPresent++;
    if (input.condition) fieldsPresent++;
    if (input.imageUrls?.length) fieldsPresent++;
    if (input.description) fieldsPresent++;
    if (input.compatibility?.length) fieldsPresent++;
    return fieldsPresent < 3;
  }
}
