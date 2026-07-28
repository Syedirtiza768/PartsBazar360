import {
  Controller,
  Post,
  Get,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ListingPipelineService } from './listing-pipeline.service';
import { CostAnalysisService } from './cost-analysis.service';
import { validateEnrichmentResult } from './schema-validation';
import { MODELS } from './model-registry';
import { ENRICHMENT_RESULT_SCHEMA } from './schema-validation';
import type {
  ListingPipelineInput,
  ListingEnrichmentResult,
  ModelConfig,
} from './types';

@Controller('listing-pipeline')
export class ListingPipelineController {
  private readonly logger = new Logger(ListingPipelineController.name);

  constructor(
    private readonly pipelineService: ListingPipelineService,
    private readonly costAnalysisService: CostAnalysisService,
  ) {}

  @Post('enrich')
  async enrich(
    @Body() body: { input: ListingPipelineInput; pipeline?: string },
  ): Promise<{
    success: boolean;
    result?: ListingEnrichmentResult;
    errors?: string[];
  }> {
    if (!body.input) {
      throw new HttpException('input is required', HttpStatus.BAD_REQUEST);
    }

    const pipeline = body.pipeline ?? 'balanced';
    if (!['budget', 'balanced', 'premium'].includes(pipeline)) {
      throw new HttpException(
        'pipeline must be: budget, balanced, or premium',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.pipelineService.enrich(body.input, pipeline);

      const schemaErrors = validateEnrichmentResult(result);
      if (schemaErrors.length > 0) {
        this.logger.warn(
          `Schema validation errors: ${schemaErrors.join('; ')}`,
        );
      }

      return {
        success: true,
        result,
        ...(schemaErrors.length > 0 ? { errors: schemaErrors } : {}),
      };
    } catch (err) {
      this.logger.error(
        `Pipeline failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new HttpException(
        `Pipeline failed: ${(err as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('validate')
  validate(@Body() body: { result: unknown }): {
    valid: boolean;
    errors: string[];
    safeToPublish: boolean;
  } {
    const errors = validateEnrichmentResult(body.result);
    const safeToPublish =
      errors.length === 0 && body.result
        ? this.checkSafeToPublish(body.result as ListingEnrichmentResult)
        : false;

    return {
      valid: errors.length === 0,
      errors,
      safeToPublish,
    };
  }

  @Get('cost-analysis')
  getCostAnalysis() {
    return this.costAnalysisService.analyzeAll();
  }

  @Get('models')
  getModels(): Array<{
    id: string;
    name: string;
    provider: string;
    inputCostPer1M: number;
    outputCostPer1M: number;
    supportsImageInput: boolean;
    supportsImageOutput: boolean;
    supportsTools: boolean;
    contextWindow: number;
    reliabilityScore: number;
  }> {
    return Object.values(MODELS).map((m: ModelConfig) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      inputCostPer1M: m.inputCostPer1M,
      outputCostPer1M: m.outputCostPer1M,
      supportsImageInput: m.supportsImageInput,
      supportsImageOutput: m.supportsImageOutput,
      supportsTools: m.supportsTools,
      contextWindow: m.contextWindow,
      reliabilityScore: m.reliabilityScore,
    }));
  }

  @Get('schema')
  getSchema() {
    return ENRICHMENT_RESULT_SCHEMA;
  }

  private checkSafeToPublish(result: ListingEnrichmentResult): boolean {
    if (result.qualityControl.routingDecision !== 'auto_publish') return false;
    if (result.qualityControl.manualReviewRequired) return false;
    if (result.qualityControl.unsupportedClaims?.length > 0) return false;
    for (const spec of result.itemSpecifics) {
      if (spec.autoPublish && spec.confidence < 0.8) return false;
      if (spec.autoPublish && spec.verificationStatus === 'conflicting')
        return false;
    }
    return true;
  }
}
