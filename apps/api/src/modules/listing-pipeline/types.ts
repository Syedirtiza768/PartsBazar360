/**
 * Core types for the AI-Powered Listing Enrichment Pipeline.
 *
 * These types define the input, intermediate, and output contracts used across
 * every stage of the pipeline: image analysis, item-specifics extraction,
 * diagram generation, compatibility verification, and quality control.
 */

// ─── Pipeline Input ─────────────────────────────────────────────────────────

export interface ListingPipelineInput {
  title?: string;
  brand?: string;
  manufacturerPartNumber?: string;
  oeNumbers?: string[];
  category?: string;
  condition?: string;
  vehicleInfo?: VehicleInfoInput;
  sellerNotes?: string;
  imageUrls?: string[];
  existingItemSpecifics?: Record<string, unknown>;
  marketplace?: string;
  marketplaceCategory?: string;
  competitorListingUrls?: string[];
  partSource?: string;
  qualityTier?: string;
  description?: string;
  compatibility?: CompatibilityInputRow[];
}

export interface VehicleInfoInput {
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  trim?: string;
  engine?: string;
  transmission?: string;
  bodyStyle?: string;
  chassisCode?: string;
  platform?: string;
}

export interface CompatibilityInputRow {
  year?: number | string;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  notes?: string;
}

// ─── Evidence & Confidence ──────────────────────────────────────────────────

export type EvidenceSource =
  | 'seller'
  | 'image'
  | 'manufacturer'
  | 'marketplace'
  | 'external_database'
  | 'inference';

export type VerificationStatus =
  'verified' | 'probable' | 'unverified' | 'conflicting';

export type IdentificationStatus = 'confirmed' | 'probable' | 'unknown';

export type DiagramType =
  | 'annotated_photo'
  | 'technical_callout'
  | 'placement_diagram'
  | 'dimensions_diagram'
  | 'connector_mounting'
  | 'compatibility_verification'
  | 'combination';

export type PipelineStage =
  | 'input_analysis'
  | 'image_extraction'
  | 'product_identification'
  | 'item_specifics'
  | 'compatibility'
  | 'diagram_prompt'
  | 'image_generation'
  | 'title_description'
  | 'validation'
  | 'quality_control';

export type RoutingDecision =
  | 'auto_publish'
  | 'publish_with_warning'
  | 'secondary_ai_review'
  | 'human_review'
  | 'reject';

// ─── Pipeline Output ────────────────────────────────────────────────────────

export interface ListingEnrichmentResult {
  inputSummary: InputSummary;
  productIdentification: ProductIdentification;
  itemSpecifics: ItemSpecificField[];
  compatibility: CompatibilityRecord[];
  listingContent: ListingContent;
  diagram: DiagramSpec;
  qualityControl: QualityControl;
  modelUsage: ModelUsageRecord[];
}

export interface InputSummary {
  title: string;
  category: string;
  condition: string;
  identifiers: string[];
  imagesAnalyzed: number;
}

export interface ProductIdentification {
  productName: string;
  brand: string;
  partNumber: string;
  identificationStatus: IdentificationStatus;
  confidence: number;
  evidence: EvidenceRecord[];
}

export interface EvidenceRecord {
  field: string;
  value: string;
  source: EvidenceSource;
  confidence: number;
}

export interface ItemSpecificField {
  field: string;
  value: string | null;
  normalizedValue: string | null;
  source: EvidenceSource;
  confidence: number;
  verificationStatus: VerificationStatus;
  autoPublish: boolean;
  alternativeValues?: string[];
  reason: string;
}

export interface CompatibilityRecord {
  make: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  trim: string;
  engine: string;
  bodyStyle: string;
  market: string;
  notes: string;
  confidence: number;
  verificationStatus: VerificationStatus;
}

export interface ListingContent {
  optimizedTitle: string;
  conditionDescription: string;
  shortDescription: string;
  keyFeatures: string[];
  buyerVerificationNotice: string;
  compatibilityDisclaimer: string;
  recommendedImageLabels: string[];
}

export interface DiagramSpec {
  recommendedDiagramType: DiagramType;
  imageGenerationPrompt: string;
  negativePrompt: string;
  labels: DiagramLabel[];
  verifiedClaimsOnly: boolean;
  outputFormat: {
    aspectRatio: string;
    width: number;
    height: number;
  };
}

export interface DiagramLabel {
  text: string;
  position: string;
  type: 'callout' | 'arrow' | 'warning' | 'info' | 'dimension';
  verified: boolean;
}

export interface QualityControl {
  overallConfidence: number;
  routingDecision: RoutingDecision;
  conflicts: QualityConflict[];
  missingCriticalFields: string[];
  unsupportedClaims: string[];
  manualReviewRequired: boolean;
  manualReviewReasons: string[];
  validationReport: ValidationReport;
}

export interface QualityConflict {
  field: string;
  values: Array<{ value: string; source: EvidenceSource; confidence: number }>;
  resolution: string;
}

export interface ValidationReport {
  supportedClaims: number;
  unsupportedClaims: number;
  conflictingClaims: number;
  missingMandatory: string[];
  marketplaceViolations: string[];
  fieldsRequiringReview: string[];
}

export interface ModelUsageRecord {
  stage: PipelineStage;
  openRouterModelId: string;
  reasonSelected: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

// ─── Model Configuration ────────────────────────────────────────────────────

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  supportsImageInput: boolean;
  supportsImageOutput: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  contextWindow: number;
  strengths: string[];
  weaknesses: string[];
  avgLatencyMs: number;
  reliabilityScore: number;
}

export interface PipelineConfig {
  name: 'budget' | 'balanced' | 'premium';
  stages: Record<PipelineStage, ModelConfig>;
  maxRetries: number;
  confidenceThresholds: ConfidenceThresholds;
}

export interface ConfidenceThresholds {
  autoPublish: number;
  publishWithWarning: number;
  secondaryReview: number;
  humanReview: number;
  reject: number;
}

// ─── OpenRouter API ─────────────────────────────────────────────────────────

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenRouterContentPart[];
}

export interface OpenRouterContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  modalities?: Array<'text' | 'image'>;
  image_config?: {
    aspect_ratio?: string;
    image_size?: string;
  };
  response_format?: {
    type: 'json_object' | 'json_schema';
    json_schema?: unknown;
  };
  tools?: unknown[];
  tool_choice?: string;
}

export interface OpenRouterImagePart {
  type?: string;
  image_url?: { url: string };
  /** Some SDK shapes use camelCase. */
  imageUrl?: { url: string };
}

export interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      reasoning?: string | null;
      tool_calls?: unknown[];
      images?: OpenRouterImagePart[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}
