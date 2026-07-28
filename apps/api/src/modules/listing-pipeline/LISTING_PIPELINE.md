# AI-Powered Listing Enrichment Pipeline

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ListingPipelineController                     │
│                  POST /listing-pipeline/enrich                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ModelRouter (dynamic routing)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Budget Config │  │Balanced Cfg  │  │  Premium Config    │    │
│  │  $0.002/list  │  │ $0.01/list   │  │   $0.08/list       │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ListingPipelineService                         │
│                                                                  │
│  Stage 1: Input Analysis ───────────────────────────────────┐   │
│  Stage 2: Image Extraction (vision model) ──────────────────┤   │
│  Stage 3: Product Identification ───────────────────────────┤   │
│  Stage 4: Item Specifics Extraction ────────────────────────┤   │
│  Stage 5: Compatibility Verification ───────────────────────┤   │
│  Stage 6: Diagram Prompt Generation ────────────────────────┤   │
│  Stage 7: Title & Description ──────────────────────────────┤   │
│  Stage 8: Quality Control & Validation ─────────────────────┘   │
│                                                                  │
│  Each stage:                                                     │
│  - Selects model via ModelRouter                                 │
│  - Calls OpenRouterClient                                        │
│  - Parses JSON response                                          │
│  - Tracks token usage & cost                                     │
│  - Feeds confidence to next stage                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Schema Validation Layer                          │
│  - validateEnrichmentResult()                                    │
│  - isSafeToAutoPublish()                                         │
│  - Hallucination detection via validation prompt                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              ListingEnrichmentResult (JSON output)               │
│  - inputSummary                                                  │
│  - productIdentification                                         │
│  - itemSpecifics[]                                               │
│  - compatibility[]                                               │
│  - listingContent                                                │
│  - diagram                                                       │
│  - qualityControl (routing decision)                             │
│  - modelUsage[] (cost tracking)                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Files

```
apps/api/src/modules/listing-pipeline/
├── index.ts                          # Public exports
├── types.ts                          # All TypeScript interfaces
├── model-registry.ts                 # Model catalog + pipeline configs
├── model-router.ts                   # Dynamic model routing logic
├── openrouter-client.ts              # OpenRouter API client wrapper
├── schema-validation.ts              # JSON schema + validation logic
├── listing-pipeline.service.ts       # Main pipeline orchestrator
├── listing-pipeline.controller.ts    # REST API endpoints
├── listing-pipeline.module.ts        # NestJS module
├── cost-analysis.service.ts          # Cost estimation engine
├── prompts/
│   ├── index.ts                      # Prompt re-exports
│   ├── image-analysis.ts             # Vision/OCR stage prompts
│   ├── item-specifics.ts             # Item specifics extraction prompts
│   ├── diagram-prompt.ts             # Diagram generation prompts
│   ├── compatibility.ts              # Fitment verification prompts
│   ├── title-description.ts          # Title/description generation prompts
│   └── validation.ts                 # Hallucination detection prompts
└── LISTING_PIPELINE.md               # This file
```

---

## 1. OpenRouter Model Comparison Table

Prices sourced from https://openrouter.ai/models on 2026-07-27. All costs USD per 1M tokens.

### Budget Vision / OCR Models

| Model ID | Provider | Input $/1M | Output $/1M | Vision | Tools | Context | Reliability |
|---|---|---|---|---|---|---|---|
| `google/gemini-2.5-flash-lite` | Google | $0.10 | $0.40 | ✅ | ✅ | 1M | 0.82 |
| `openai/gpt-4.1-nano` | OpenAI | $0.10 | $0.40 | ✅ | ✅ | 1M | 0.85 |
| `mistralai/mistral-small-3.2-24b` | Mistral | $0.10 | $0.30 | ✅ | ✅ | 262K | 0.78 |
| `openai/gpt-4.1-mini` | OpenAI | $0.40 | $1.60 | ✅ | ✅ | 1M | 0.92 |
| `google/gemini-2.5-flash` | Google | $0.30 | $2.50 | ✅ | ✅ | 1M | 0.90 |
| `qwen/qwen2.5-vl-72b-instruct` | Qwen | $0.80 | $1.00 | ✅ | ❌ | 128K | 0.87 |

### Mid-Tier Reasoning Models

| Model ID | Provider | Input $/1M | Output $/1M | Vision | Tools | Context | Reliability |
|---|---|---|---|---|---|---|---|
| `xiaomi/mimo-v2.5-pro` | Xiaomi | $0.44 | $0.87 | ❌ | ✅ | 1M | 0.88 |
| `openai/o4-mini` | OpenAI | $1.10 | $4.40 | ✅ | ✅ | 200K | 0.93 |
| `google/gemini-2.5-pro` | Google | $1.25 | $10.00 | ✅ | ✅ | 1M | 0.94 |
| `openai/gpt-4.1` | OpenAI | $2.00 | $8.00 | ✅ | ✅ | 1M | 0.96 |
| `anthropic/claude-sonnet-4` | Anthropic | $3.00 | $15.00 | ✅ | ✅ | 1M | 0.97 |

### Premium Models

| Model ID | Provider | Input $/1M | Output $/1M | Vision | Tools | Context | Reliability |
|---|---|---|---|---|---|---|---|
| `anthropic/claude-opus-4.5` | Anthropic | $5.00 | $25.00 | ✅ | ✅ | 1M | 0.99 |
| `anthropic/claude-opus-5` | Anthropic | $5.00 | $25.00 | ✅ | ✅ | 1M | 0.99 |

### Image Generation Models

| Model ID | Provider | Input $/1M | Output $/1M | Image In | Image Out | Notes |
|---|---|---|---|---|---|---|
| `google/gemini-2.0-flash-preview-image` | Google | $0.10 | $0.40 | ✅ | ✅ | Cheapest image gen |
| `google/gemini-2.5-flash-preview-image` | Google | $0.30 | $2.50 | ✅ | ✅ | Best value image gen |
| `openai/gpt-image-1` | OpenAI | $5.00 | $10.00 | ✅ | ✅ | Highest quality |

---

## 2. Recommended Models per Pipeline Stage

| Stage | Budget | Balanced | Premium |
|---|---|---|---|
| Input Analysis | `gpt-4.1-nano` | `gpt-4.1-mini` | `gpt-4.1-mini` |
| Image Extraction | `gemini-2.5-flash-lite` | `gpt-4.1-mini` | `gemini-2.5-pro` |
| Product ID | `gpt-4.1-nano` | `gpt-4.1-mini` | `gemini-2.5-pro` |
| Item Specifics | `gpt-4.1-nano` | `gpt-4.1-mini` | `claude-sonnet-4` |
| Compatibility | `gpt-4.1-nano` | `gpt-4.1-mini` | `claude-sonnet-4` |
| Diagram Prompt | `gpt-4.1-nano` | `gpt-4.1-mini` | `claude-sonnet-4` |
| Image Generation | `gemini-2.0-flash-img` | `gemini-2.5-flash-img` | `gpt-image-1` |
| Title/Description | `gpt-4.1-nano` | `gpt-4.1-mini` | `claude-sonnet-4` |
| Validation | `gpt-4.1-nano` | `gemini-2.5-flash` | `claude-sonnet-4` |
| Quality Control | `gpt-4.1-nano` | `gpt-4.1-mini` | `claude-opus-4.5` |

**Rationale for multi-model over single-model:**
- Different stages have different requirements (vision vs. reasoning vs. structured output)
- A single cheap model cannot match specialized quality at each stage
- A single premium model is wasteful for simple extraction tasks
- Multi-model routing saves 60-80% vs. using the premium model for everything

---

## 3. Cost Analysis

### Per-Listing Estimates (including 10% retry/validation buffer)

| Pipeline | Per Listing | 100 Listings | 1,000 Listings | 10,000 Listings |
|---|---|---|---|---|
| **Budget** | ~$0.002 | ~$0.20 | ~$2.00 | ~$20.00 |
| **Balanced** | ~$0.012 | ~$1.20 | ~$12.00 | ~$120.00 |
| **Premium** | ~$0.085 | ~$8.50 | ~$85.00 | ~$850.00 |

### Assumptions
- Average listing has 3-5 product images
- ~1,200 input tokens for text-only stages
- ~2,000 input tokens for vision stages (images encode to ~800 tokens each)
- ~1,500 average output tokens per stage
- 8 stages per pipeline run (not all always execute)
- 10% retry/validation buffer included
- Image generation cost varies by model (budget: ~$0.0001, premium: ~$0.01)

### Per-Stage Token Estimates

| Stage | Input Tokens | Output Tokens | Calls |
|---|---|---|---|
| Image Extraction | 2,000 (vision) | 1,200 | 1 |
| Item Specifics | 1,200 | 1,800 | 1 |
| Compatibility | 1,000 | 1,500 | 1 |
| Diagram Prompt | 1,500 | 800 | 1 |
| Title/Description | 1,200 | 600 | 1 |
| Validation | 3,000 | 2,000 | 1 |

---

## 4. Model Routing Logic

### Confidence Thresholds

| Threshold | Budget | Balanced | Premium | Action |
|---|---|---|---|---|
| Auto Publish | ≥0.85 | ≥0.90 | ≥0.95 | Publish directly |
| Publish + Warning | ≥0.65 | ≥0.75 | ≥0.80 | Publish with disclaimers |
| Secondary AI Review | ≥0.45 | ≥0.50 | ≥0.60 | Re-run with stronger model |
| Human Review | ≥0.25 | ≥0.30 | ≥0.40 | Queue for manual review |
| Reject | <0.25 | <0.30 | <0.40 | Do not publish |

### Escalation Rules

```
1. Low OCR confidence → escalate to stronger vision model
2. Multiple similar product matches → escalate reasoning model
3. Conflicting evidence → require external verification
4. Sparse input data (<3 fields) → escalate item_specifics model
5. Complex compatibility (>20 rows) → escalate compatibility model
6. Critical unsupported claims → flag for human review
7. Poor image quality → skip image generation
8. Hallucination detected → reject + human review
```

---

## 5. API Endpoints

### POST /listing-pipeline/enrich
Run the full enrichment pipeline.

```json
{
  "input": {
    "title": "Toyota Corolla Front Left Fender 2014-2019 OEM 53802-02170",
    "brand": "TOYOTA",
    "manufacturerPartNumber": "53802-02170",
    "oeNumbers": ["53802-02170", "53802-02171"],
    "condition": "USED",
    "imageUrls": ["https://...jpg"],
    "vehicleInfo": {
      "make": "Toyota",
      "model": "Corolla",
      "yearFrom": 2014,
      "yearTo": 2019
    },
    "marketplace": "ebay"
  },
  "pipeline": "balanced"
}
```

### POST /listing-pipeline/validate
Validate an enrichment result against the schema.

### GET /listing-pipeline/cost-analysis
Get cost estimates for all pipeline configurations.

### GET /listing-pipeline/models
List available models with pricing and capabilities.

### GET /listing-pipeline/schema
Get the JSON schema for enrichment results.

---

## 6. Hallucination Prevention Rules

### Never
- Invent OEM numbers
- Invent compatibility beyond evidence
- Invent dimensions without measurement data
- Invent certifications
- Invent warranty coverage
- Invent unconfirmed materials
- Convert visual similarity into confirmed identification
- Copy unverified competitor claims
- State "tested" without testing evidence
- Add features because they're "common" for the category

### Always
- Cite evidence source for every claim
- Assign confidence score (0.0-1.0)
- Mark unverified claims as `autoPublish: false`
- Flag conflicting values
- Run validation pass comparing claims to evidence
- Preserve original values alongside normalized values

### Validation Pipeline
1. Every generated claim is compared against cited evidence
2. Claims with only inference-level evidence get `autoPublish: false`
3. The validation stage checks for hallucination patterns
4. Critical hallucinations trigger `routingDecision: reject`
5. Unsupported claims are listed in `qualityControl.unsupportedClaims`

---

## 7. Example End-to-End Output

### Input
```json
{
  "title": "Toyota Camry Headlight Assembly 2018-2020 Left Side OEM 81110-06520",
  "brand": "TOYOTA",
  "manufacturerPartNumber": "81110-06520",
  "oeNumbers": ["81110-06520"],
  "condition": "USED",
  "imageUrls": ["https://example.com/camry-headlight-1.jpg"],
  "vehicleInfo": {
    "make": "Toyota",
    "model": "Camry",
    "yearFrom": 2018,
    "yearTo": 2020
  }
}
```

### Output (abbreviated)
```json
{
  "inputSummary": {
    "title": "Toyota Camry Headlight Assembly 2018-2020 Left Side OEM 81110-06520",
    "category": "Lighting",
    "condition": "USED",
    "identifiers": ["MPN:81110-06520", "OE:81110-06520"],
    "imagesAnalyzed": 1
  },
  "productIdentification": {
    "productName": "Toyota Camry Left Headlight Assembly",
    "brand": "TOYOTA",
    "partNumber": "81110-06520",
    "identificationStatus": "confirmed",
    "confidence": 0.92,
    "evidence": [
      {"field": "brand", "value": "TOYOTA", "source": "seller", "confidence": 0.95},
      {"field": "partNumber", "value": "81110-06520", "source": "seller", "confidence": 0.9}
    ]
  },
  "itemSpecifics": [
    {
      "field": "Brand",
      "value": "TOYOTA",
      "normalizedValue": "TOYOTA",
      "source": "seller",
      "confidence": 0.95,
      "verificationStatus": "verified",
      "autoPublish": true,
      "reason": "Seller-provided brand matches image-visible logo"
    },
    {
      "field": "Manufacturer Part Number",
      "value": "81110-06520",
      "normalizedValue": "8111006520",
      "source": "seller",
      "confidence": 0.9,
      "verificationStatus": "verified",
      "autoPublish": true,
      "reason": "Seller-provided MPN, verify against physical part"
    },
    {
      "field": "Part Type",
      "value": "Headlight Assembly",
      "normalizedValue": "Headlight Assembly",
      "source": "image",
      "confidence": 0.92,
      "verificationStatus": "verified",
      "autoPublish": true,
      "reason": "Product visually identified as headlight assembly"
    },
    {
      "field": "Placement on Vehicle",
      "value": "Front Left",
      "normalizedValue": "Front Left",
      "source": "seller",
      "confidence": 0.88,
      "verificationStatus": "probable",
      "autoPublish": true,
      "reason": "Title indicates left side; image orientation consistent"
    },
    {
      "field": "Material",
      "value": "Plastic",
      "normalizedValue": "Plastic",
      "source": "inference",
      "confidence": 0.7,
      "verificationStatus": "unverified",
      "autoPublish": false,
      "reason": "Headlight housings are typically plastic; not confirmed from image"
    },
    {
      "field": "Condition",
      "value": "Used",
      "normalizedValue": "Used",
      "source": "seller",
      "confidence": 0.95,
      "verificationStatus": "verified",
      "autoPublish": true,
      "reason": "Seller declared condition"
    },
    {
      "field": "Lens Color",
      "value": "Clear",
      "normalizedValue": "Clear",
      "source": "image",
      "confidence": 0.85,
      "verificationStatus": "probable",
      "autoPublish": true,
      "reason": "Observed from product images"
    }
  ],
  "compatibility": [
    {
      "make": "Toyota",
      "model": "Camry",
      "yearFrom": 2018,
      "yearTo": 2020,
      "trim": "",
      "engine": "",
      "bodyStyle": "Sedan",
      "market": "US",
      "notes": "Verify trim level; some trims may have different headlight configurations",
      "confidence": 0.85,
      "verificationStatus": "probable"
    }
  ],
  "listingContent": {
    "optimizedTitle": "Toyota Camry Left Headlight Assembly 2018-2020 OEM 81110-06520 Used",
    "conditionDescription": "Used OEM headlight assembly. Normal wear consistent with age. Lens is clear with no major cracks or haze. Housing intact. See photos for exact condition.",
    "shortDescription": "Genuine Toyota left side headlight assembly for 2018-2020 Camry. OEM part number 81110-06520. Removed from a running vehicle.",
    "keyFeatures": [
      "Genuine OEM Toyota part",
      "Direct bolt-on replacement",
      "Includes headlight housing and lens",
      "Left/driver side"
    ],
    "buyerVerificationNotice": "Please verify the OEM part number 81110-06520 matches your vehicle before purchasing. Check your existing headlight for the part number sticker.",
    "compatibilityDisclaimer": "Fitment is based on OEM part number cross-reference. Always verify with your vehicle's VIN or existing part number.",
    "recommendedImageLabels": ["Front view", "Back/connector view", "Part number label", "Mounting points"]
  },
  "diagram": {
    "recommendedDiagramType": "technical_callout",
    "imageGenerationPrompt": "Professional product photograph of a Toyota Camry left headlight assembly on a clean white background. Add labeled callout arrows pointing to: the OEM part number label (81110-06520), the electrical connector, the mounting bolt locations, the lens surface, and the adjuster screws. Use clean sans-serif font. Include a 'Verify part number before purchase' notice at the bottom. 2000x2000 pixels, square format.",
    "negativePrompt": "blurry, low quality, misleading condition, fake logos, watermark, text overlay, new condition labels on used part",
    "labels": [
      {"text": "OEM: 81110-06520", "position": "top-right", "type": "callout", "verified": true},
      {"text": "TOYOTA", "position": "top-left", "type": "info", "verified": true},
      {"text": "Headlight Assembly", "position": "bottom-left", "type": "info", "verified": true},
      {"text": "Front Left", "position": "bottom-right", "type": "callout", "verified": true},
      {"text": "Verify part number before purchase", "position": "bottom-center", "type": "warning", "verified": true}
    ],
    "verifiedClaimsOnly": true,
    "outputFormat": {"aspectRatio": "1:1", "width": 2000, "height": 2000}
  },
  "qualityControl": {
    "overallConfidence": 0.88,
    "routingDecision": "publish_with_warning",
    "conflicts": [],
    "missingCriticalFields": [],
    "unsupportedClaims": [],
    "manualReviewRequired": false,
    "manualReviewReasons": [],
    "validationReport": {
      "supportedClaims": 7,
      "unsupportedClaims": 0,
      "conflictingClaims": 0,
      "missingMandatory": [],
      "marketplaceViolations": [],
      "fieldsRequiringReview": []
    }
  },
  "modelUsage": [
    {"stage": "image_extraction", "openRouterModelId": "openai/gpt-4.1-mini", "reasonSelected": "Pipeline stage: image_extraction", "inputTokens": 2100, "outputTokens": 1100, "estimatedCostUsd": 0.002600},
    {"stage": "item_specifics", "openRouterModelId": "openai/gpt-4.1-mini", "reasonSelected": "Pipeline stage: item_specifics", "inputTokens": 1300, "outputTokens": 1900, "estimatedCostUsd": 0.003560},
    {"stage": "compatibility", "openRouterModelId": "openai/gpt-4.1-mini", "reasonSelected": "Pipeline stage: compatibility", "inputTokens": 1100, "outputTokens": 1400, "estimatedCostUsd": 0.002680},
    {"stage": "diagram_prompt", "openRouterModelId": "openai/gpt-4.1-mini", "reasonSelected": "Pipeline stage: diagram_prompt", "inputTokens": 1600, "outputTokens": 750, "estimatedCostUsd": 0.001840},
    {"stage": "title_description", "openRouterModelId": "openai/gpt-4.1-mini", "reasonSelected": "Pipeline stage: title_description", "inputTokens": 1200, "outputTokens": 550, "estimatedCostUsd": 0.001360}
  ]
}
```

---

## 8. Error, Retry, Fallback, and Manual Review Logic

### Retry Strategy
- **Default retries:** 2 (budget), 3 (balanced/premium)
- **Retryable errors:** 429 (rate limit), 502/503 (server), ECONNRESET, timeout
- **Backoff:** Exponential, 1s → 2s → 4s, capped at 10s
- **Non-retryable:** 400 (bad request), 401 (auth), 422 (unprocessable)

### Fallback Chain
```
Stage fails → use fallback/default values → reduce confidence →
  if confidence > threshold → continue with warnings
  if confidence < threshold → queue for human review
```

### Per-Stage Fallbacks
- **Image extraction fails** → skip, reduce overall confidence by 0.2
- **Item specifics fails** → use seller-provided data only, mark all as `autoPublish: false`
- **Compatibility fails** → use existing compatibility data from input
- **Diagram fails** → use fallback labels with basic product info
- **Title/description fails** → use original title + basic condition description
- **Validation fails** → mark as `secondary_ai_review` with "validation incomplete" reason

### Manual Review Triggers
1. `routingDecision` is `human_review` or `reject`
2. Critical unsupported claims detected
3. Hallucination flags from validation stage
4. Conflicting evidence that cannot be auto-resolved
5. Missing mandatory marketplace fields
6. Confidence below human review threshold

---

## 9. Integration with Existing Codebase

### Register in AppModule

```typescript
// apps/api/src/app.module.ts
import { ListingPipelineModule } from './modules/listing-pipeline/listing-pipeline.module';

@Module({
  imports: [
    // ... existing modules
    ListingPipelineModule,
  ],
})
export class AppModule {}
```

### Use in Ingestion Pipeline

```typescript
// In your ingestion processor or enrichment script
import { ListingPipelineService } from '../listing-pipeline/listing-pipeline.service';

@Injectable()
export class IngestionProcessor {
  constructor(private readonly pipeline: ListingPipelineService) {}

  async enrichListing(canonicalPart: CanonicalPart) {
    const result = await this.pipeline.enrich({
      title: canonicalPart.title,
      brand: canonicalPart.brand,
      manufacturerPartNumber: canonicalPart.manufacturerPartNumber,
      oeNumbers: canonicalPart.oeNumbers,
      imageUrls: canonicalPart.imageUrls,
      condition: canonicalPart.qualityTier,
      compatibility: canonicalPart.compatibility as any[],
    }, 'balanced');

    // Store item specifics
    await this.prisma.canonicalPart.update({
      where: { id: canonicalPart.id },
      data: {
        itemSpecifics: result.itemSpecifics,
        enrichedAt: new Date(),
        enrichmentSource: `pipeline:balanced:${result.modelUsage[0]?.openRouterModelId}`,
      },
    });
  }
}
```

### Environment Variables

```env
# Required
OPENROUTER_API_KEY=sk-or-...

# Optional
LISTING_PIPELINE_DEFAULT=budget|balanced|premium
LISTING_PIPELINE_MAX_RETRIES=3
LISTING_PIPELINE_TIMEOUT_MS=30000
```

---

## 10. Key Risks and Limitations

| Risk | Impact | Mitigation |
|---|---|---|
| Hallucinated OEM numbers | High — buyer receives wrong part | Evidence hierarchy, validation stage, `autoPublish: false` for inference-only |
| Incorrect compatibility | High — fitment claims | Separate confirmed vs. possible, require VIN verification for low confidence |
| Image quality too poor | Medium — bad diagram output | `shouldSkipImageGeneration()` check, fallback labels |
| Model rate limits | Medium — pipeline stalls | Exponential backoff, multi-model fallback, queue system |
| Cost overrun at scale | Medium — budget exceeded | Budget/balanced/premium configs, cost tracking per listing |
| Language/encoding issues | Low — garbled output | JSON extraction with regex fallback, markdown fence stripping |
| Stale model pricing | Low — inaccurate cost estimates | Pricing sourced from OpenRouter API, update model-registry.ts periodically |
