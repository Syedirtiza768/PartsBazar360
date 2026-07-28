import { Injectable } from '@nestjs/common';
import { MODELS, PIPELINE_CONFIGS, estimateCost } from './model-registry';
import type { PipelineStage, ModelUsageRecord } from './types';

/**
 * Cost analysis engine for the listing enrichment pipeline.
 * Estimates per-listing and bulk costs for each pipeline configuration.
 */

export interface StageCostEstimate {
  stage: PipelineStage;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  callsPerListing: number;
}

export interface PipelineCostEstimate {
  configName: string;
  stages: StageCostEstimate[];
  totalPerListing: number;
  totalFor100: number;
  totalFor1000: number;
  totalFor10000: number;
}

@Injectable()
export class CostAnalysisService {
  /**
   * Generate cost estimates for all three pipeline configurations.
   */
  analyzeAll(): {
    budget: PipelineCostEstimate;
    balanced: PipelineCostEstimate;
    premium: PipelineCostEstimate;
    comparison: Record<
      string,
      { perListing: string; for100: string; for1000: string; for10000: string }
    >;
  } {
    const budget = this.analyzePipeline('budget');
    const balanced = this.analyzePipeline('balanced');
    const premium = this.analyzePipeline('premium');

    return {
      budget,
      balanced,
      premium,
      comparison: {
        budget: {
          perListing: `$${budget.totalPerListing.toFixed(4)}`,
          for100: `$${budget.totalFor100.toFixed(2)}`,
          for1000: `$${budget.totalFor1000.toFixed(2)}`,
          for10000: `$${budget.totalFor10000.toFixed(2)}`,
        },
        balanced: {
          perListing: `$${balanced.totalPerListing.toFixed(4)}`,
          for100: `$${balanced.totalFor100.toFixed(2)}`,
          for1000: `$${balanced.totalFor1000.toFixed(2)}`,
          for10000: `$${balanced.totalFor10000.toFixed(2)}`,
        },
        premium: {
          perListing: `$${premium.totalPerListing.toFixed(4)}`,
          for100: `$${premium.totalFor100.toFixed(2)}`,
          for1000: `$${premium.totalFor1000.toFixed(2)}`,
          for10000: `$${premium.totalFor10000.toFixed(2)}`,
        },
      },
    };
  }

  /**
   * Estimate cost for a single pipeline configuration.
   */
  analyzePipeline(configName: string): PipelineCostEstimate {
    const config = PIPELINE_CONFIGS[configName];
    if (!config) throw new Error(`Unknown config: ${configName}`);

    const stageEstimates: StageCostEstimate[] = [];

    for (const [stage, model] of Object.entries(config.stages)) {
      const tokens = this.estimateTokensForStage(
        stage as PipelineStage,
        model.id,
      );
      const cost = estimateCost(model, tokens.input, tokens.output);
      stageEstimates.push({
        stage: stage as PipelineStage,
        modelId: model.id,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        costUsd: cost,
        callsPerListing: tokens.calls,
      });
    }

    const totalPerListing = stageEstimates.reduce(
      (sum, s) => sum + s.costUsd * s.callsPerListing,
      0,
    );

    // Add 10% buffer for retries and validation calls
    const withBuffer = totalPerListing * 1.1;

    return {
      configName,
      stages: stageEstimates,
      totalPerListing: withBuffer,
      totalFor100: withBuffer * 100,
      totalFor1000: withBuffer * 1000,
      totalFor10000: withBuffer * 10000,
    };
  }

  /**
   * Estimate token usage for a given pipeline stage.
   * Based on observed averages from the existing enrich-itemspecifics.mjs runs.
   */
  private estimateTokensForStage(
    stage: PipelineStage,
    modelId: string,
  ): { input: number; output: number; calls: number } {
    // Image input tokens are higher due to vision encoding
    const isVisionModel = MODELS[modelId]?.supportsImageInput ?? false;

    switch (stage) {
      case 'input_analysis':
        return { input: 500, output: 300, calls: 1 };
      case 'image_extraction':
        return {
          input: isVisionModel ? 2000 : 800,
          output: 1200,
          calls: 1,
        };
      case 'product_identification':
        return { input: 800, output: 400, calls: 1 };
      case 'item_specifics':
        return { input: 1200, output: 1800, calls: 1 };
      case 'compatibility':
        return { input: 1000, output: 1500, calls: 1 };
      case 'diagram_prompt':
        return { input: 1500, output: 800, calls: 1 };
      case 'image_generation':
        return { input: 1000, output: 500, calls: 1 };
      case 'title_description':
        return { input: 1200, output: 600, calls: 1 };
      case 'validation':
        return { input: 3000, output: 2000, calls: 1 };
      case 'quality_control':
        return { input: 1000, output: 500, calls: 1 };
      default:
        return { input: 1000, output: 500, calls: 1 };
    }
  }

  /**
   * Estimate cost from actual pipeline usage records.
   */
  calculateActualCost(usage: ModelUsageRecord[]): number {
    return usage.reduce((sum, u) => sum + u.estimatedCostUsd, 0);
  }
}
