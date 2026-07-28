import type { ListingEnrichmentResult } from './types';

/**
 * JSON Schema for the listing enrichment result.
 * Used for strict validation before persisting to the database.
 */
export const ENRICHMENT_RESULT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: [
    'inputSummary',
    'productIdentification',
    'itemSpecifics',
    'compatibility',
    'listingContent',
    'diagram',
    'qualityControl',
    'modelUsage',
  ],
  properties: {
    inputSummary: {
      type: 'object',
      required: [
        'title',
        'category',
        'condition',
        'identifiers',
        'imagesAnalyzed',
      ],
      properties: {
        title: { type: 'string' },
        category: { type: 'string' },
        condition: { type: 'string' },
        identifiers: { type: 'array', items: { type: 'string' } },
        imagesAnalyzed: { type: 'integer', minimum: 0 },
      },
    },
    productIdentification: {
      type: 'object',
      required: [
        'productName',
        'brand',
        'partNumber',
        'identificationStatus',
        'confidence',
        'evidence',
      ],
      properties: {
        productName: { type: 'string' },
        brand: { type: 'string' },
        partNumber: { type: 'string' },
        identificationStatus: {
          type: 'string',
          enum: ['confirmed', 'probable', 'unknown'],
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            required: ['field', 'value', 'source', 'confidence'],
            properties: {
              field: { type: 'string' },
              value: { type: 'string' },
              source: {
                type: 'string',
                enum: [
                  'seller',
                  'image',
                  'manufacturer',
                  'marketplace',
                  'external_database',
                  'inference',
                ],
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
    itemSpecifics: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'field',
          'source',
          'confidence',
          'verificationStatus',
          'autoPublish',
          'reason',
        ],
        properties: {
          field: { type: 'string' },
          value: { type: ['string', 'null'] },
          normalizedValue: { type: ['string', 'null'] },
          source: {
            type: 'string',
            enum: [
              'seller',
              'image',
              'manufacturer',
              'marketplace',
              'external_database',
              'inference',
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          verificationStatus: {
            type: 'string',
            enum: ['verified', 'probable', 'unverified', 'conflicting'],
          },
          autoPublish: { type: 'boolean' },
          alternativeValues: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
      },
    },
    compatibility: {
      type: 'array',
      items: {
        type: 'object',
        required: ['make', 'model', 'confidence', 'verificationStatus'],
        properties: {
          make: { type: 'string' },
          model: { type: 'string' },
          yearFrom: { type: ['integer', 'null'] },
          yearTo: { type: ['integer', 'null'] },
          trim: { type: 'string' },
          engine: { type: 'string' },
          bodyStyle: { type: 'string' },
          market: { type: 'string' },
          notes: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          verificationStatus: {
            type: 'string',
            enum: ['verified', 'probable', 'unverified', 'conflicting'],
          },
        },
      },
    },
    listingContent: {
      type: 'object',
      required: [
        'optimizedTitle',
        'conditionDescription',
        'shortDescription',
        'keyFeatures',
        'buyerVerificationNotice',
      ],
      properties: {
        optimizedTitle: { type: 'string', maxLength: 80 },
        conditionDescription: { type: 'string' },
        shortDescription: { type: 'string' },
        keyFeatures: { type: 'array', items: { type: 'string' } },
        buyerVerificationNotice: { type: 'string' },
        compatibilityDisclaimer: { type: 'string' },
        recommendedImageLabels: { type: 'array', items: { type: 'string' } },
      },
    },
    diagram: {
      type: 'object',
      required: [
        'recommendedDiagramType',
        'imageGenerationPrompt',
        'negativePrompt',
        'labels',
        'verifiedClaimsOnly',
        'outputFormat',
      ],
      properties: {
        recommendedDiagramType: {
          type: 'string',
          enum: [
            'annotated_photo',
            'technical_callout',
            'placement_diagram',
            'dimensions_diagram',
            'connector_mounting',
            'compatibility_verification',
            'combination',
          ],
        },
        imageGenerationPrompt: { type: 'string' },
        negativePrompt: { type: 'string' },
        labels: {
          type: 'array',
          items: {
            type: 'object',
            required: ['text', 'position', 'type', 'verified'],
            properties: {
              text: { type: 'string' },
              position: { type: 'string' },
              type: {
                type: 'string',
                enum: ['callout', 'arrow', 'warning', 'info', 'dimension'],
              },
              verified: { type: 'boolean' },
            },
          },
        },
        verifiedClaimsOnly: { type: 'boolean' },
        outputFormat: {
          type: 'object',
          required: ['aspectRatio', 'width', 'height'],
          properties: {
            aspectRatio: { type: 'string' },
            width: { type: 'integer' },
            height: { type: 'integer' },
          },
        },
      },
    },
    qualityControl: {
      type: 'object',
      required: [
        'overallConfidence',
        'routingDecision',
        'conflicts',
        'missingCriticalFields',
        'manualReviewRequired',
        'manualReviewReasons',
        'validationReport',
      ],
      properties: {
        overallConfidence: { type: 'number', minimum: 0, maximum: 1 },
        routingDecision: {
          type: 'string',
          enum: [
            'auto_publish',
            'publish_with_warning',
            'secondary_ai_review',
            'human_review',
            'reject',
          ],
        },
        conflicts: { type: 'array' },
        missingCriticalFields: { type: 'array', items: { type: 'string' } },
        unsupportedClaims: { type: 'array', items: { type: 'string' } },
        manualReviewRequired: { type: 'boolean' },
        manualReviewReasons: { type: 'array', items: { type: 'string' } },
        validationReport: {
          type: 'object',
          required: [
            'supportedClaims',
            'unsupportedClaims',
            'conflictingClaims',
            'missingMandatory',
            'marketplaceViolations',
            'fieldsRequiringReview',
          ],
          properties: {
            supportedClaims: { type: 'integer' },
            unsupportedClaims: { type: 'integer' },
            conflictingClaims: { type: 'integer' },
            missingMandatory: { type: 'array', items: { type: 'string' } },
            marketplaceViolations: { type: 'array', items: { type: 'string' } },
            fieldsRequiringReview: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    modelUsage: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'stage',
          'openRouterModelId',
          'reasonSelected',
          'inputTokens',
          'outputTokens',
          'estimatedCostUsd',
        ],
        properties: {
          stage: { type: 'string' },
          openRouterModelId: { type: 'string' },
          reasonSelected: { type: 'string' },
          inputTokens: { type: 'integer', minimum: 0 },
          outputTokens: { type: 'integer', minimum: 0 },
          estimatedCostUsd: { type: 'number', minimum: 0 },
        },
      },
    },
  },
};

/**
 * Validate a raw JSON object against the enrichment result schema.
 * Returns an array of validation errors (empty if valid).
 */
export function validateEnrichmentResult(data: unknown): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return ['Root must be an object'];
  }

  const obj = data as Record<string, unknown>;

  // Required top-level fields
  const required = [
    'inputSummary',
    'productIdentification',
    'itemSpecifics',
    'compatibility',
    'listingContent',
    'diagram',
    'qualityControl',
    'modelUsage',
  ];
  for (const field of required) {
    if (!(field in obj)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate inputSummary
  if (obj.inputSummary && typeof obj.inputSummary === 'object') {
    const is = obj.inputSummary as Record<string, unknown>;
    if (typeof is.title !== 'string')
      errors.push('inputSummary.title must be a string');
    if (typeof is.imagesAnalyzed !== 'number')
      errors.push('inputSummary.imagesAnalyzed must be a number');
    if (!Array.isArray(is.identifiers))
      errors.push('inputSummary.identifiers must be an array');
  }

  // Validate productIdentification
  if (
    obj.productIdentification &&
    typeof obj.productIdentification === 'object'
  ) {
    const pi = obj.productIdentification as Record<string, unknown>;
    const validStatuses = ['confirmed', 'probable', 'unknown'];
    if (!validStatuses.includes(pi.identificationStatus as string)) {
      errors.push(
        `productIdentification.identificationStatus must be one of: ${validStatuses.join(', ')}`,
      );
    }
    if (
      typeof pi.confidence !== 'number' ||
      pi.confidence < 0 ||
      pi.confidence > 1
    ) {
      errors.push(
        'productIdentification.confidence must be a number between 0 and 1',
      );
    }
  }

  // Validate itemSpecifics
  if (Array.isArray(obj.itemSpecifics)) {
    for (let i = 0; i < obj.itemSpecifics.length; i++) {
      const spec = obj.itemSpecifics[i] as Record<string, unknown>;
      if (typeof spec.field !== 'string') {
        errors.push(`itemSpecifics[${i}].field must be a string`);
      }
      if (
        typeof spec.confidence !== 'number' ||
        spec.confidence < 0 ||
        spec.confidence > 1
      ) {
        errors.push(`itemSpecifics[${i}].confidence must be 0-1`);
      }
      const validSources = [
        'seller',
        'image',
        'manufacturer',
        'marketplace',
        'external_database',
        'inference',
      ];
      if (!validSources.includes(spec.source as string)) {
        errors.push(
          `itemSpecifics[${i}].source must be one of: ${validSources.join(', ')}`,
        );
      }
      const validVerification = [
        'verified',
        'probable',
        'unverified',
        'conflicting',
      ];
      if (!validVerification.includes(spec.verificationStatus as string)) {
        errors.push(
          `itemSpecifics[${i}].verificationStatus must be one of: ${validVerification.join(', ')}`,
        );
      }
      if (typeof spec.autoPublish !== 'boolean') {
        errors.push(`itemSpecifics[${i}].autoPublish must be a boolean`);
      }
    }
  }

  // Validate listingContent
  if (obj.listingContent && typeof obj.listingContent === 'object') {
    const lc = obj.listingContent as Record<string, unknown>;
    if (
      typeof lc.optimizedTitle === 'string' &&
      lc.optimizedTitle.length > 80
    ) {
      errors.push(
        'listingContent.optimizedTitle must be 80 characters or less',
      );
    }
    if (!Array.isArray(lc.keyFeatures)) {
      errors.push('listingContent.keyFeatures must be an array');
    }
  }

  // Validate qualityControl
  if (obj.qualityControl && typeof obj.qualityControl === 'object') {
    const qc = obj.qualityControl as Record<string, unknown>;
    const validDecisions = [
      'auto_publish',
      'publish_with_warning',
      'secondary_ai_review',
      'human_review',
      'reject',
    ];
    if (!validDecisions.includes(qc.routingDecision as string)) {
      errors.push(
        `qualityControl.routingDecision must be one of: ${validDecisions.join(', ')}`,
      );
    }
  }

  // Validate modelUsage
  if (Array.isArray(obj.modelUsage)) {
    for (let i = 0; i < obj.modelUsage.length; i++) {
      const mu = obj.modelUsage[i] as Record<string, unknown>;
      if (typeof mu.openRouterModelId !== 'string') {
        errors.push(`modelUsage[${i}].openRouterModelId must be a string`);
      }
      if (typeof mu.estimatedCostUsd !== 'number') {
        errors.push(`modelUsage[${i}].estimatedCostUsd must be a number`);
      }
    }
  }

  return errors;
}

/**
 * Check if a result is safe to auto-publish.
 */
export function isSafeToAutoPublish(result: ListingEnrichmentResult): boolean {
  if (result.qualityControl.routingDecision !== 'auto_publish') return false;
  if (result.qualityControl.manualReviewRequired) return false;
  if (
    result.qualityControl.unsupportedClaims &&
    result.qualityControl.unsupportedClaims.length > 0
  )
    return false;

  // Check that all auto-publish items have high confidence
  for (const spec of result.itemSpecifics) {
    if (spec.autoPublish && spec.confidence < 0.8) return false;
    if (spec.autoPublish && spec.verificationStatus === 'conflicting')
      return false;
  }

  return true;
}
