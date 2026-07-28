import { Injectable, Logger } from '@nestjs/common';
import { OpenRouterClient } from './openrouter-client';
import { ModelRouter } from './model-router';
import {
  buildImageAnalysisSystemPrompt,
  buildImageAnalysisUserPrompt,
  buildItemSpecificsSystemPrompt,
  buildItemSpecificsUserPrompt,
  buildDiagramSystemPrompt,
  buildDiagramUserPrompt,
  buildFallbackLabels,
  buildValidationSystemPrompt,
  buildValidationUserPrompt,
  buildTitleDescriptionSystemPrompt,
  buildTitleDescriptionUserPrompt,
  buildCompatibilitySystemPrompt,
  buildCompatibilityUserPrompt,
} from './prompts';
import { validateEnrichmentResult } from './schema-validation';
import type {
  ListingPipelineInput,
  ListingEnrichmentResult,
  ItemSpecificField,
  CompatibilityRecord,
  DiagramSpec,
  ListingContent,
  QualityControl,
  ProductIdentification,
  InputSummary,
  ModelUsageRecord,
  OpenRouterMessage,
  OpenRouterContentPart,
} from './types';

@Injectable()
export class ListingPipelineService {
  private readonly logger = new Logger(ListingPipelineService.name);

  /**
   * Run the full enrichment pipeline for a single listing.
   */
  async enrich(
    input: ListingPipelineInput,
    pipelineConfigName: string = 'balanced',
  ): Promise<ListingEnrichmentResult> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

    const client = new OpenRouterClient(apiKey);
    const router = new ModelRouter(pipelineConfigName);
    const config = router.getConfig();
    this.logger.log(
      `Starting pipeline [${config.name}] for: ${input.title ?? 'untitled'}`,
    );

    const allUsage: ModelUsageRecord[] = [];
    let priorConfidence = 1.0;

    // ── Stage 1: Input Analysis ───────────────────────────────────────────
    const inputSummary = this.buildInputSummary(input);

    // ── Stage 2: Image Extraction (if images available) ───────────────────
    let imageAnalysis: Record<string, unknown> | null = null;
    if (input.imageUrls && input.imageUrls.length > 0) {
      const model = router.selectModel(
        'image_extraction',
        input,
        priorConfidence,
      );
      this.logger.debug(`Image extraction: ${model.id}`);
      try {
        const msgs = this.buildVisionMessages(
          buildImageAnalysisSystemPrompt(),
          buildImageAnalysisUserPrompt(
            input.imageUrls,
            input.title,
            input.brand,
            input.oeNumbers,
          ),
          input.imageUrls,
        );
        const result = await client.call({
          model,
          stage: 'image_extraction',
          messages: msgs,
          maxTokens: 4096,
          maxRetries: config.maxRetries,
        });
        allUsage.push(result.usage);
        imageAnalysis = OpenRouterClient.extractJson(result.content) as Record<
          string,
          unknown
        >;
        priorConfidence = (imageAnalysis.confidence as number) ?? 0.8;
      } catch (err) {
        this.logger.warn(`Image extraction failed: ${(err as Error).message}`);
        priorConfidence = 0.5;
      }
    }

    // ── Stage 3: Product Identification ───────────────────────────────────
    const productIdentification = this.buildProductIdentification(
      input,
      imageAnalysis,
    );

    // ── Stage 4: Item Specifics ───────────────────────────────────────────
    let itemSpecifics: ItemSpecificField[] = [];
    {
      const model = router.selectModel(
        'item_specifics',
        input,
        priorConfidence,
      );
      this.logger.debug(`Item specifics: ${model.id}`);
      const sysPrompt = buildItemSpecificsSystemPrompt();
      const userPrompt = buildItemSpecificsUserPrompt({
        title: input.title,
        brand: input.brand,
        manufacturerPartNumber: input.manufacturerPartNumber,
        oeNumbers: input.oeNumbers,
        category: input.category,
        condition: input.condition,
        sellerNotes: input.sellerNotes,
        description: input.description,
        partSource: input.partSource,
        qualityTier: input.qualityTier,
        imageAnalysis: imageAnalysis ?? undefined,
        compatibility: input.compatibility as unknown as Array<
          Record<string, unknown>
        >,
      });

      const messages: OpenRouterMessage[] = [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ];

      try {
        const result = await client.call({
          model,
          stage: 'item_specifics',
          messages,
          maxTokens: 4096,
          maxRetries: config.maxRetries,
        });
        allUsage.push(result.usage);
        const parsed = OpenRouterClient.extractJson(result.content) as Record<
          string,
          unknown
        >;
        itemSpecifics = Array.isArray(parsed.itemSpecifics)
          ? (parsed.itemSpecifics as ItemSpecificField[])
          : [];
      } catch (err) {
        this.logger.warn(
          `Item specifics extraction failed: ${(err as Error).message}`,
        );
      }
    }

    // ── Stage 5: Compatibility ────────────────────────────────────────────
    let compatibility: CompatibilityRecord[] = [];
    {
      const model = router.selectModel('compatibility', input, priorConfidence);
      this.logger.debug(`Compatibility: ${model.id}`);
      const sysPrompt = buildCompatibilitySystemPrompt();
      const userPrompt = buildCompatibilityUserPrompt({
        title: input.title,
        brand: input.brand,
        oeNumbers: input.oeNumbers,
        manufacturerPartNumber: input.manufacturerPartNumber,
        compatibility: input.compatibility as unknown as Array<
          Record<string, unknown>
        >,
        vehicleInfo: input.vehicleInfo as unknown as Record<string, unknown>,
        imageAnalysis: imageAnalysis ?? undefined,
      });

      const messages: OpenRouterMessage[] = [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ];

      try {
        const result = await client.call({
          model,
          stage: 'compatibility',
          messages,
          maxTokens: 4096,
          maxRetries: config.maxRetries,
        });
        allUsage.push(result.usage);
        const parsed = OpenRouterClient.extractJson(result.content) as Record<
          string,
          unknown
        >;
        compatibility = Array.isArray(parsed.compatibility)
          ? (parsed.compatibility as CompatibilityRecord[])
          : [];
      } catch (err) {
        this.logger.warn(
          `Compatibility verification failed: ${(err as Error).message}`,
        );
      }
    }

    // ── Stage 6: Diagram Prompt Generation ────────────────────────────────
    let diagram: DiagramSpec;
    {
      const model = router.selectModel(
        'diagram_prompt',
        input,
        priorConfidence,
      );
      this.logger.debug(`Diagram prompt: ${model.id}`);

      if (router.shouldSkipImageGeneration(input)) {
        diagram = this.buildFallbackDiagram(input, itemSpecifics);
      } else {
        const sysPrompt = buildDiagramSystemPrompt();
        const userPrompt = buildDiagramUserPrompt({
          title: input.title,
          brand: input.brand,
          partNumber: input.manufacturerPartNumber ?? input.oeNumbers?.[0],
          condition: input.condition,
          partType:
            itemSpecifics.find((s) => s.field === 'Part Type')?.value ??
            undefined,
          placement:
            itemSpecifics.find((s) => s.field === 'Placement on Vehicle')
              ?.value ?? undefined,
          imageAnalysis: imageAnalysis ?? undefined,
          itemSpecifics: itemSpecifics as unknown as Array<
            Record<string, unknown>
          >,
          compatibility: compatibility as unknown as Array<
            Record<string, unknown>
          >,
          isAutomotive: this.isAutomotive(input),
        });

        const messages: OpenRouterMessage[] = [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt },
        ];

        try {
          const result = await client.call({
            model,
            stage: 'diagram_prompt',
            messages,
            maxTokens: 2048,
            maxRetries: config.maxRetries,
          });
          allUsage.push(result.usage);
          const parsed = OpenRouterClient.extractJson(result.content) as Record<
            string,
            unknown
          >;
          diagram = {
            recommendedDiagramType:
              (parsed.diagramType as DiagramSpec['recommendedDiagramType']) ??
              'annotated_photo',
            imageGenerationPrompt: (parsed.prompt as string) ?? '',
            negativePrompt: (parsed.negativePrompt as string) ?? '',
            labels: (parsed.labels as DiagramSpec['labels']) ?? [],
            verifiedClaimsOnly: true,
            outputFormat: { aspectRatio: '1:1', width: 2000, height: 2000 },
          };
        } catch (err) {
          this.logger.warn(
            `Diagram prompt generation failed: ${(err as Error).message}`,
          );
          diagram = this.buildFallbackDiagram(input, itemSpecifics);
        }
      }
    }

    // ── Stage 7: Title & Description ──────────────────────────────────────
    let listingContent: ListingContent;
    {
      const model = router.selectModel(
        'title_description',
        input,
        priorConfidence,
      );
      this.logger.debug(`Title/description: ${model.id}`);
      const sysPrompt = buildTitleDescriptionSystemPrompt();
      const userPrompt = buildTitleDescriptionUserPrompt({
        title: input.title,
        brand: input.brand,
        partNumber: input.manufacturerPartNumber ?? input.oeNumbers?.[0],
        oeNumbers: input.oeNumbers,
        condition: input.condition,
        partType:
          itemSpecifics.find((s) => s.field === 'Part Type')?.value ??
          undefined,
        placement:
          itemSpecifics.find((s) => s.field === 'Placement on Vehicle')
            ?.value ?? undefined,
        vehicleSystem:
          itemSpecifics.find((s) => s.field === 'Vehicle System')?.value ??
          undefined,
        compatibility: compatibility as unknown as Array<
          Record<string, unknown>
        >,
        itemSpecifics: itemSpecifics as unknown as Array<
          Record<string, unknown>
        >,
        imageAnalysis: imageAnalysis ?? undefined,
        marketplace: input.marketplace,
      });

      const messages: OpenRouterMessage[] = [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ];

      try {
        const result = await client.call({
          model,
          stage: 'title_description',
          messages,
          maxTokens: 2048,
          maxRetries: config.maxRetries,
        });
        allUsage.push(result.usage);
        const parsed = OpenRouterClient.extractJson(result.content) as Record<
          string,
          unknown
        >;
        listingContent = {
          optimizedTitle:
            (parsed.optimizedTitle as string) ?? input.title ?? '',
          conditionDescription: (parsed.conditionDescription as string) ?? '',
          shortDescription: (parsed.shortDescription as string) ?? '',
          keyFeatures: (parsed.keyFeatures as string[]) ?? [],
          buyerVerificationNotice:
            (parsed.buyerVerificationNotice as string) ??
            'Please verify the part number and fitment before purchasing.',
          compatibilityDisclaimer:
            (parsed.compatibilityDisclaimer as string) ??
            'Compatibility information is provided as a guide. Always verify with your vehicle specifications.',
          recommendedImageLabels:
            (parsed.recommendedImageLabels as string[]) ?? [],
        };
      } catch (err) {
        this.logger.warn(
          `Title/description generation failed: ${(err as Error).message}`,
        );
        listingContent = this.buildFallbackListingContent(input, itemSpecifics);
      }
    }

    // ── Stage 8: Quality Control & Validation ─────────────────────────────
    let qualityControl: QualityControl;
    {
      const preliminaryConfidence = this.calculateOverallConfidence(
        productIdentification,
        itemSpecifics,
        compatibility,
      );

      if (router.shouldValidate(preliminaryConfidence)) {
        const model = router.selectModel(
          'validation',
          input,
          preliminaryConfidence,
        );
        this.logger.debug(`Validation: ${model.id}`);
        const sysPrompt = buildValidationSystemPrompt();
        const userPrompt = buildValidationUserPrompt(
          { ...input, imageAnalysis },
          { itemSpecifics, compatibility, listingContent, diagram },
        );

        const messages: OpenRouterMessage[] = [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt },
        ];

        try {
          const result = await client.call({
            model,
            stage: 'validation',
            messages,
            maxTokens: 4096,
            maxRetries: config.maxRetries,
          });
          allUsage.push(result.usage);
          const validation = OpenRouterClient.extractJson(
            result.content,
          ) as Record<string, unknown>;
          qualityControl = this.buildQualityControl(
            preliminaryConfidence,
            validation,
            itemSpecifics,
            router,
          );
        } catch (err) {
          this.logger.warn(`Validation failed: ${(err as Error).message}`);
          qualityControl = this.buildFallbackQualityControl(
            preliminaryConfidence,
            router,
          );
        }
      } else {
        qualityControl = this.buildFallbackQualityControl(
          preliminaryConfidence,
          router,
        );
      }
    }

    // ── Assemble Result ───────────────────────────────────────────────────
    const result: ListingEnrichmentResult = {
      inputSummary,
      productIdentification,
      itemSpecifics,
      compatibility,
      listingContent,
      diagram,
      qualityControl,
      modelUsage: allUsage,
    };

    // Final schema validation
    const schemaErrors = validateEnrichmentResult(result);
    if (schemaErrors.length > 0) {
      this.logger.warn(`Schema validation errors: ${schemaErrors.join('; ')}`);
    }

    const totalCost = allUsage.reduce((sum, u) => sum + u.estimatedCostUsd, 0);
    this.logger.log(
      `Pipeline complete [${config.name}]: confidence=${qualityControl.overallConfidence.toFixed(2)}, ` +
        `decision=${qualityControl.routingDecision}, cost=$${totalCost.toFixed(4)}, ` +
        `stages=${allUsage.length}`,
    );

    return result;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private buildInputSummary(input: ListingPipelineInput): InputSummary {
    const identifiers: string[] = [];
    if (input.manufacturerPartNumber)
      identifiers.push(`MPN:${input.manufacturerPartNumber}`);
    if (input.oeNumbers?.length) {
      for (const oe of input.oeNumbers) identifiers.push(`OE:${oe}`);
    }
    return {
      title: input.title ?? 'Unknown',
      category: input.category ?? 'Unknown',
      condition: input.condition ?? 'Unknown',
      identifiers,
      imagesAnalyzed: input.imageUrls?.length ?? 0,
    };
  }

  private buildProductIdentification(
    input: ListingPipelineInput,
    imageAnalysis: Record<string, unknown> | null,
  ): ProductIdentification {
    const evidence: ProductIdentification['evidence'] = [];
    let brand = input.brand ?? '';
    let partNumber = input.manufacturerPartNumber ?? input.oeNumbers?.[0] ?? '';
    let confidence = 0;
    let status: ProductIdentification['identificationStatus'] = 'unknown';

    if (input.brand) {
      evidence.push({
        field: 'brand',
        value: input.brand,
        source: 'seller',
        confidence: 0.95,
      });
      confidence = Math.max(confidence, 0.9);
    }
    if (input.manufacturerPartNumber) {
      evidence.push({
        field: 'partNumber',
        value: input.manufacturerPartNumber,
        source: 'seller',
        confidence: 0.9,
      });
      confidence = Math.max(confidence, 0.85);
    }
    if (imageAnalysis?.brand && typeof imageAnalysis.brand === 'string') {
      const imgBrand = imageAnalysis.brand;
      if (!brand) brand = imgBrand;
      evidence.push({
        field: 'brand',
        value: imgBrand,
        source: 'image',
        confidence: 0.8,
      });
    }
    if (
      Array.isArray(imageAnalysis?.partNumbers) &&
      imageAnalysis.partNumbers.length > 0
    ) {
      const imgPn = (imageAnalysis.partNumbers as string[])[0];
      if (!partNumber) partNumber = imgPn;
      evidence.push({
        field: 'partNumber',
        value: imgPn,
        source: 'image',
        confidence: 0.85,
      });
    }

    if (confidence >= 0.8) status = 'confirmed';
    else if (confidence >= 0.5) status = 'probable';

    return {
      productName: input.title ?? 'Unknown Part',
      brand,
      partNumber,
      identificationStatus: status,
      confidence,
      evidence,
    };
  }

  private buildQualityControl(
    preliminaryConfidence: number,
    validation: Record<string, unknown>,
    itemSpecifics: ItemSpecificField[],
    router: ModelRouter,
  ): QualityControl {
    const overall = validation.overallAssessment as
      Record<string, unknown> | undefined;
    const adjustedConfidence = overall
      ? this.adjustConfidenceFromValidation(preliminaryConfidence, overall)
      : preliminaryConfidence;

    const unsupported = Array.isArray(validation.unsupportedClaims)
      ? (validation.unsupportedClaims as Array<Record<string, unknown>>)
      : [];
    const conflicts = Array.isArray(validation.conflictingClaims)
      ? (validation.conflictingClaims as Array<Record<string, unknown>>)
      : [];
    const missingMandatory = Array.isArray(validation.missingMandatory)
      ? (validation.missingMandatory as string[])
      : [];
    const violations = Array.isArray(validation.marketplaceViolations)
      ? (validation.marketplaceViolations as string[])
      : [];
    const reviewFields = Array.isArray(validation.fieldsRequiringReview)
      ? (validation.fieldsRequiringReview as string[])
      : [];

    const routingDecision = router.getRoutingDecision(adjustedConfidence);
    const manualReviewRequired =
      routingDecision === 'human_review' ||
      routingDecision === 'reject' ||
      unsupported.some((u) => u.severity === 'critical');

    const reasons: string[] = [];
    if (manualReviewRequired) {
      if (routingDecision === 'reject')
        reasons.push('Low confidence — rejected');
      else if (routingDecision === 'human_review')
        reasons.push('Confidence below human review threshold');
      for (const u of unsupported.filter((u) => u.severity === 'critical')) {
        reasons.push(`Critical unsupported claim: ${String(u.field)}`);
      }
    }

    return {
      overallConfidence: adjustedConfidence,
      routingDecision,
      conflicts: conflicts.map((c) => ({
        field: (c.field as string) ?? '',
        values: (c.values as QualityControl['conflicts'][0]['values']) ?? [],
        resolution: (c.recommendation as string) ?? 'Review required',
      })),
      missingCriticalFields: missingMandatory,
      unsupportedClaims: unsupported.map(
        (u) => `${String(u.field)}: ${String(u.value)}`,
      ),
      manualReviewRequired,
      manualReviewReasons: reasons,
      validationReport: {
        supportedClaims:
          (validation.supportedClaims as Array<unknown>)?.length ?? 0,
        unsupportedClaims: unsupported.length,
        conflictingClaims: conflicts.length,
        missingMandatory,
        marketplaceViolations: violations,
        fieldsRequiringReview: reviewFields,
      },
    };
  }

  private buildFallbackQualityControl(
    confidence: number,
    router: ModelRouter,
  ): QualityControl {
    const routingDecision = router.getRoutingDecision(confidence);
    return {
      overallConfidence: confidence,
      routingDecision,
      conflicts: [],
      missingCriticalFields: [],
      unsupportedClaims: [],
      manualReviewRequired:
        routingDecision === 'human_review' || routingDecision === 'reject',
      manualReviewReasons:
        routingDecision === 'reject' ? ['Confidence below threshold'] : [],
      validationReport: {
        supportedClaims: 0,
        unsupportedClaims: 0,
        conflictingClaims: 0,
        missingMandatory: [],
        marketplaceViolations: [],
        fieldsRequiringReview: [],
      },
    };
  }

  private adjustConfidenceFromValidation(
    base: number,
    assessment: Record<string, unknown>,
  ): number {
    const risk = assessment.hallucinationRisk as string;
    if (risk === 'critical') return Math.min(base, 0.2);
    if (risk === 'high') return Math.min(base, 0.4);
    if (risk === 'medium') return Math.min(base, 0.65);
    return base;
  }

  private calculateOverallConfidence(
    identification: ProductIdentification,
    itemSpecifics: ItemSpecificField[],
    compatibility: CompatibilityRecord[],
  ): number {
    const scores: number[] = [identification.confidence];
    for (const spec of itemSpecifics) {
      scores.push(spec.confidence * (spec.autoPublish ? 1.0 : 0.7));
    }
    for (const comp of compatibility) {
      scores.push(comp.confidence * 0.8);
    }
    if (scores.length === 0) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  private buildFallbackDiagram(
    input: ListingPipelineInput,
    itemSpecifics: ItemSpecificField[],
  ): DiagramSpec {
    const partType =
      itemSpecifics.find((s) => s.field === 'Part Type')?.value ?? undefined;
    const placement =
      itemSpecifics.find((s) => s.field === 'Placement on Vehicle')?.value ??
      undefined;
    return {
      recommendedDiagramType: 'annotated_photo',
      imageGenerationPrompt: `Professional product photograph of ${input.title ?? 'automotive part'} with clean white background. Add callout labels for brand, part number, and key features. Marketplace-ready, 2000x2000 pixels.`,
      negativePrompt:
        'blurry, low quality, misleading condition, fake logos, watermark',
      labels: buildFallbackLabels({
        brand: input.brand,
        partNumber: input.manufacturerPartNumber ?? input.oeNumbers?.[0],
        partType,
        placement,
        condition: input.condition,
      }),
      verifiedClaimsOnly: true,
      outputFormat: { aspectRatio: '1:1', width: 2000, height: 2000 },
    };
  }

  private buildFallbackListingContent(
    input: ListingPipelineInput,
    _itemSpecifics: ItemSpecificField[],
  ): ListingContent {
    const parts: string[] = [];
    if (input.brand) parts.push(input.brand);
    if (input.title) parts.push(input.title);
    if (input.manufacturerPartNumber)
      parts.push(`MPN: ${input.manufacturerPartNumber}`);
    if (input.condition) parts.push(`[${input.condition}]`);

    return {
      optimizedTitle: parts.join(' ').substring(0, 80),
      conditionDescription:
        input.condition === 'USED' ? 'Used part in described condition.' : '',
      shortDescription: input.title ?? '',
      keyFeatures: [],
      buyerVerificationNotice:
        'Please verify the part number and fitment before purchasing.',
      compatibilityDisclaimer:
        'Compatibility information is provided as a guide. Always verify with your vehicle specifications.',
      recommendedImageLabels: [],
    };
  }

  private buildVisionMessages(
    systemPrompt: string,
    userPrompt: string,
    imageUrls: string[],
  ): OpenRouterMessage[] {
    const contentParts: OpenRouterContentPart[] = [
      ...imageUrls.slice(0, 5).map((url) => ({
        type: 'image_url' as const,
        image_url: { url, detail: 'high' as const },
      })),
      { type: 'text' as const, text: userPrompt },
    ];
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contentParts },
    ];
  }

  private isAutomotive(input: ListingPipelineInput): boolean {
    if (input.vehicleInfo) return true;
    if (input.compatibility && input.compatibility.length > 0) return true;
    const autoKeywords = [
      'car',
      'auto',
      'vehicle',
      'truck',
      'suv',
      'motor',
      'engine',
      'brake',
      'fender',
      'bumper',
      'headlight',
      'taillight',
      'mirror',
      'hood',
      'door',
    ];
    const title = (input.title ?? '').toLowerCase();
    return autoKeywords.some((kw) => title.includes(kw));
  }
}
