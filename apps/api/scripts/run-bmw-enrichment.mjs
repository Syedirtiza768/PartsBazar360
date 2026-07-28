#!/usr/bin/env node

/**
 * Standalone BMW Listing Enrichment — Balanced Pipeline
 *
 * Runs the full 8-stage AI enrichment pipeline on one BMW part from the DB.
 * Uses OpenRouter API directly (no NestJS dependency).
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... node run-bmw-enrichment.mjs
 */

import pg from 'pg';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY is required');
  process.exit(1);
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

// ── Model configs (balanced tier) ──────────────────────────────────────────
const MODELS = {
  vision: { id: 'openai/gpt-4.1-mini', input: 0.40, output: 1.60 },
  reasoning: { id: 'openai/gpt-4.1-mini', input: 0.40, output: 1.60 },
  validation: { id: 'google/gemini-2.5-flash', input: 0.30, output: 2.50 },
  image_gen: { id: 'google/gemini-2.5-flash-preview-image', input: 0.30, output: 2.50 },
};

const usage = [];
let totalCost = 0;

// ── OpenRouter caller ──────────────────────────────────────────────────────
async function callOpenRouter(model, messages, maxTokens = 4096, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://partsbazar360.com',
          'X-Title': 'PartsBazar360 Listing Pipeline',
        },
        body: JSON.stringify({
          model: model.id,
          messages,
          temperature: 0.1,
          max_tokens: maxTokens,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          console.log(`  [retry ${attempt + 1}] ${res.status}: ${text.substring(0, 100)}`);
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(`OpenRouter ${res.status}: ${text}`);
      }

      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      let content = msg?.content?.trim() || msg?.reasoning?.trim() || '';
      if (!content) throw new Error('Empty response');

      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      const cost = (inputTokens * model.input) / 1_000_000 + (outputTokens * model.output) / 1_000_000;
      totalCost += cost;
      usage.push({ model: model.id, inputTokens, outputTokens, cost });

      return content;
    } catch (err) {
      if (attempt < retries && err.message.includes('fetch')) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
}

function extractJson(text) {
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  return JSON.parse(cleaned);
}

// ── Fetch one unenriched BMW part ──────────────────────────────────────────
async function fetchOneBmwPart(pool) {
  const { rows } = await pool.query(`
    SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber",
      cp."oeNumbers", cp.description, cp.compatibility, cp."partType",
      cp.position, cp."vehicleSystem", cp."imageUrls", cp."qualityTier",
      cp."partSource"
    FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON cp.id = so."canonicalPartId"
    JOIN "Seller" s ON so."sellerId" = s.id
    WHERE so.status = 'ACTIVE'
      AND s."onboardingStatus" = 'ACTIVE'
      AND cp.compatibility IS NOT NULL
      AND jsonb_typeof(cp.compatibility) = 'array'
      AND jsonb_path_exists(cp.compatibility, '$[*].make ? (@ == "BMW")')
      AND cp."itemSpecifics" IS NULL
    ORDER BY cp.title
    LIMIT 1
  `);
  return rows[0] || null;
}

// ── Stage 1: Image Analysis ────────────────────────────────────────────────
async function stageImageAnalysis(part) {
  console.log('\n[Stage 1/7] Image Analysis...');
  const imageUrls = part.imageUrls || [];
  if (imageUrls.length === 0) {
    console.log('  No images — skipping');
    return null;
  }

  const imageParts = imageUrls.slice(0, 3).map(url => ({
    type: 'image_url',
    image_url: { url, detail: 'high' },
  }));

  const messages = [
    { role: 'system', content: `You are a product image analyst for an automotive parts marketplace.
Extract factual information from product photographs. Report ONLY what you can observe.
Return ONLY valid JSON:
{
  "observedText": ["array of visible text, labels, markings"],
  "partNumbers": ["clearly readable part numbers"],
  "brand": "visible brand name or null",
  "productType": "what the product appears to be",
  "orientation": "front/rear/left/right/top/bottom/unknown",
  "condition": {"overall": "new/used/damaged/unknown", "details": "description", "confidence": 0.0-1.0},
  "visibleFeatures": ["notable physical features"],
  "connectors": ["visible connectors, ports, plugs"],
  "mountingPoints": ["visible mounting holes, brackets"],
  "materialIndicators": ["apparent materials"],
  "colorDescription": "apparent colors",
  "vehiclePlacementClues": "where this mounts on a vehicle",
  "confidence": 0.0-1.0
}` },
    { role: 'user', content: [
      ...imageParts,
      { type: 'text', text: `Analyze these product images.\nTitle: ${part.title}\nBrand: ${part.brand || 'unknown'}\nOE Numbers: ${(part.oeNumbers || []).join(', ')}` }
    ] }
  ];

  const raw = await callOpenRouter(MODELS.vision, messages, 4096);
  const result = extractJson(raw);
  console.log(`  Product: ${result.productType || '?'} | Confidence: ${result.confidence || '?'}`);
  return result;
}

// ── Stage 2: Item Specifics ────────────────────────────────────────────────
async function stageItemSpecifics(part, imageAnalysis) {
  console.log('\n[Stage 2/7] Item Specifics Extraction...');

  const compat = Array.isArray(part.compatibility) ? part.compatibility : [];
  const sampleCompat = compat.slice(0, 5).map(f =>
    [f.make, f.model, f.year, f.trim, f.engine].filter(Boolean).join(' ')
  ).join('; ');

  let userPrompt = `Generate eBay Motors item specifics for this BMW part:

Title: ${part.title}
Brand: ${part.brand || 'unknown'}
MPN: ${part.manufacturerPartNumber || 'unknown'}
OE Numbers: ${(part.oeNumbers || []).join(', ')}
Condition: ${part.qualityTier || 'USED'}
Part Source: ${part.partSource || 'OEM'}`;

  if (sampleCompat) userPrompt += `\nFitment (${compat.length} rows): ${sampleCompat}`;
  if (imageAnalysis) {
    userPrompt += `\n\nImage Analysis:`;
    if (imageAnalysis.productType) userPrompt += `\nProduct: ${imageAnalysis.productType}`;
    if (imageAnalysis.visibleFeatures) userPrompt += `\nFeatures: ${imageAnalysis.visibleFeatures.join(', ')}`;
    if (imageAnalysis.connectors) userPrompt += `\nConnectors: ${imageAnalysis.connectors.join(', ')}`;
    if (imageAnalysis.materialIndicators) userPrompt += `\nMaterials: ${imageAnalysis.materialIndicators.join(', ')}`;
  }

  const messages = [
    { role: 'system', content: `You are an automotive parts catalog specialist for BMW parts.
Generate standardized eBay Motors item specifics as valid JSON.

RULES:
- Return ONLY valid JSON. No markdown fences.
- Infer placement from title keywords (front/rear/left/right/driver/passenger).
- For used OEM parts: brandType="OEM Genuine", condition="Used", warranty="No Warranty".
- vehicleSystem: Body & Frame, Engine, Drivetrain, Electrical, Suspension & Brakes, Interior, HVAC, Exhaust, Fuel System, Cooling System, Steering, Lighting, Safety, Accessories.
- If a field cannot be determined, use null.

SCHEMA:
{
  "itemSpecifics": [
    {
      "field": "field name",
      "value": "value or null",
      "normalizedValue": "cleaned value or null",
      "source": "seller | image | inference",
      "confidence": 0.0-1.0,
      "verificationStatus": "verified | probable | unverified",
      "autoPublish": true/false,
      "reason": "how determined"
    }
  ],
  "productClassification": {
    "partType": "specific part type",
    "vehicleSystem": "major vehicle system",
    "categoryType": "specific category"
  }
}` },
    { role: 'user', content: userPrompt }
  ];

  const raw = await callOpenRouter(MODELS.reasoning, messages, 4096);
  const result = extractJson(raw);
  const specs = result.itemSpecifics || [];
  console.log(`  Extracted ${specs.length} item specifics`);
  for (const s of specs.slice(0, 8)) {
    console.log(`    ${s.field}: ${s.value} [${s.source}, ${(s.confidence * 100).toFixed(0)}%, ${s.autoPublish ? 'AUTO' : 'REVIEW'}]`);
  }
  return result;
}

// ── Stage 3: Compatibility Verification ────────────────────────────────────
async function stageCompatibility(part, imageAnalysis) {
  console.log('\n[Stage 3/7] Compatibility Verification...');

  const compat = Array.isArray(part.compatibility) ? part.compatibility : [];
  const sample = compat.slice(0, 10).map(f =>
    [f.make, f.model, f.year, f.trim, f.engine].filter(Boolean).join(' ')
  ).join('\n  ');

  let userPrompt = `Verify fitment for this BMW part:

Title: ${part.title}
Brand: ${part.brand || 'unknown'}
MPN: ${part.manufacturerPartNumber || 'unknown'}
OE Numbers: ${(part.oeNumbers || []).join(', ')}
Compatibility (${compat.length} rows total):
  ${sample}`;

  if (imageAnalysis?.partNumbers) {
    userPrompt += `\nPart numbers from images: ${imageAnalysis.partNumbers.join(', ')}`;
  }

  const messages = [
    { role: 'system', content: `You are an automotive fitment specialist verifying BMW part compatibility.
RULES:
- Do NOT infer compatibility from keywords alone.
- Normalize OEM numbers (remove spaces/dots/hyphens, preserve original).
- Separate CONFIRMED from POSSIBLE compatibility.
- Do NOT claim universal fit without evidence.

Return ONLY valid JSON:
{
  "compatibility": [
    {
      "make": "BMW", "model": "...", "yearFrom": null, "yearTo": null,
      "trim": "", "engine": "", "bodyStyle": "", "market": "",
      "notes": "restrictions or caveats",
      "confidence": 0.0-1.0,
      "verificationStatus": "verified | probable | unverified"
    }
  ],
  "partNumberAnalysis": {
    "normalizedOem": "cleaned number",
    "originalOem": "original number",
    "numberType": "exact_part | part_family | superseded | interchangeable | unknown",
    "supersedes": [],
    "interchangeNumbers": [],
    "notes": ""
  },
  "fitmentWarnings": [],
  "recommendedVerification": []
}` },
    { role: 'user', content: userPrompt }
  ];

  const raw = await callOpenRouter(MODELS.reasoning, messages, 4096);
  const result = extractJson(raw);
  const rows = result.compatibility || [];
  console.log(`  Verified ${rows.length} compatibility rows`);
  if (result.partNumberAnalysis) {
    console.log(`  OEM type: ${result.partNumberAnalysis.numberType || '?'}`);
  }
  if (result.fitmentWarnings?.length) {
    console.log(`  Warnings: ${result.fitmentWarnings.join('; ')}`);
  }
  return result;
}

// ── Stage 4: Diagram Prompt ────────────────────────────────────────────────
async function stageDiagramPrompt(part, imageAnalysis, itemSpecifics) {
  console.log('\n[Stage 4/7] Diagram Prompt Generation...');

  if (!part.imageUrls?.length) {
    console.log('  No images — using fallback diagram');
    return buildFallbackDiagram(part, itemSpecifics);
  }

  const partType = itemSpecifics?.itemSpecifics?.find(s => s.field === 'Part Type')?.value || '';
  const placement = itemSpecifics?.itemSpecifics?.find(s => s.field === 'Placement on Vehicle')?.value || '';

  let userPrompt = `Generate a diagram prompt for this BMW part:

Title: ${part.title}
Brand: ${part.brand || 'unknown'}
Part Number: ${part.manufacturerPartNumber || part.oeNumbers?.[0] || 'unknown'}
Condition: ${part.qualityTier || 'USED'}
Part Type: ${partType}
Placement: ${placement}`;

  if (imageAnalysis) {
    userPrompt += `\n\nImage Analysis:`;
    if (imageAnalysis.productType) userPrompt += `\nProduct: ${imageAnalysis.productType}`;
    if (imageAnalysis.visibleFeatures) userPrompt += `\nFeatures: ${imageAnalysis.visibleFeatures.join(', ')}`;
    if (imageAnalysis.connectors) userPrompt += `\nConnectors: ${imageAnalysis.connectors.join(', ')}`;
    if (imageAnalysis.mountingPoints) userPrompt += `\nMounting: ${imageAnalysis.mountingPoints.join(', ')}`;
  }

  userPrompt += `\n\nThis is a BMW part. The diagram should clearly communicate:
- Placement on vehicle (if determinable)
- Driver/passenger side
- Visible connectors and mounting points
- OEM number location
- "Verify part number before purchase" notice`;

  const messages = [
    { role: 'system', content: `You are a technical illustration specialist for automotive parts.
Generate detailed image-generation prompts for professional listing diagrams.

Rules:
- Use the real product image as source. Do NOT invent features.
- Keep designs professional and uncluttered.
- 2000x2000 pixels, square format.
- Keep critical content 100px from edges.

Return ONLY valid JSON:
{
  "diagramType": "annotated_photo | technical_callout | placement_diagram | connector_mounting | combination",
  "prompt": "detailed image generation prompt (200-400 words)",
  "negativePrompt": "what to avoid",
  "labels": [
    {"text": "label", "position": "where", "type": "callout|arrow|warning|info", "verified": true/false}
  ],
  "reasoning": "why this diagram type"
}` },
    { role: 'user', content: userPrompt }
  ];

  const raw = await callOpenRouter(MODELS.reasoning, messages, 2048);
  const result = extractJson(raw);
  console.log(`  Diagram type: ${result.diagramType || '?'}`);
  console.log(`  Labels: ${(result.labels || []).length}`);
  return result;
}

function buildFallbackDiagram(part, itemSpecifics) {
  return {
    diagramType: 'annotated_photo',
    prompt: `Professional product photograph of ${part.title} with clean white background. Add callout labels for brand, part number, and key features. Marketplace-ready, 2000x2000 pixels.`,
    negativePrompt: 'blurry, low quality, misleading condition, fake logos, watermark',
    labels: [
      { text: `Brand: ${part.brand || 'BMW'}`, position: 'top-left', type: 'info', verified: true },
      { text: `OEM: ${part.manufacturerPartNumber || part.oeNumbers?.[0] || '?'}`, position: 'top-right', type: 'callout', verified: true },
      { text: 'Verify part number before purchase', position: 'bottom-center', type: 'warning', verified: true },
    ],
    reasoning: 'No images available for detailed diagram',
  };
}

// ── Stage 5: Title & Description ───────────────────────────────────────────
async function stageTitleDescription(part, itemSpecifics, compatibility) {
  console.log('\n[Stage 5/7] Title & Description...');

  const specs = itemSpecifics?.itemSpecifics?.filter(s => s.autoPublish) || [];
  const compat = compatibility?.compatibility || [];
  const makes = [...new Set(compat.map(c => c.make).filter(Boolean))];
  const models = [...new Set(compat.map(c => c.model).filter(Boolean))];
  const years = compat.map(c => c.yearFrom).filter(y => y > 0);
  const yearRange = years.length ? `${Math.min(...years)}-${Math.max(...years)}` : '';

  let userPrompt = `Generate optimized eBay listing content for this BMW part:

Original title: ${part.title}
Brand: ${part.brand || 'unknown'}
MPN: ${part.manufacturerPartNumber || 'unknown'}
OE Numbers: ${(part.oeNumbers || []).join(', ')}
Condition: ${part.qualityTier || 'USED'}
Compatibility: ${makes.join(', ')} ${models.join(', ')} ${yearRange} (${compat.length} fitments)

Verified specifics:
${specs.map(s => `  ${s.field}: ${s.value}`).join('\n')}`;

  const messages = [
    { role: 'system', content: `You are a marketplace listing copywriter for BMW parts.
RULES:
- Title max 80 characters. Strongest searchable attributes first.
- Include brand, product type, OEM/MPN, placement, condition.
- No keyword stuffing. No unsupported compatibility claims. No "best" or "guaranteed".

Return ONLY valid JSON:
{
  "optimizedTitle": "max 80 chars",
  "conditionDescription": "factual condition description",
  "shortDescription": "2-3 sentence summary",
  "keyFeatures": ["3-7 features"],
  "buyerVerificationNotice": "notice to verify part number and fitment",
  "compatibilityDisclaimer": "fitment disclaimer",
  "recommendedImageLabels": ["suggested image labels"]
}` },
    { role: 'user', content: userPrompt }
  ];

  const raw = await callOpenRouter(MODELS.reasoning, messages, 2048);
  const result = extractJson(raw);
  console.log(`  Title: ${result.optimizedTitle}`);
  console.log(`  Features: ${(result.keyFeatures || []).length}`);
  return result;
}

// ── Stage 6: Validation ────────────────────────────────────────────────────
async function stageValidation(part, imageAnalysis, itemSpecifics, compatibility, listingContent) {
  console.log('\n[Stage 6/7] Validation & Hallucination Check...');

  const sourceData = {
    title: part.title,
    brand: part.brand,
    mpn: part.manufacturerPartNumber,
    oeNumbers: part.oeNumbers,
    condition: part.qualityTier,
    imageAnalysis: imageAnalysis ? {
      productType: imageAnalysis.productType,
      partNumbers: imageAnalysis.partNumbers,
      brand: imageAnalysis.brand,
      condition: imageAnalysis.condition,
    } : null,
  };

  const enrichmentOutput = {
    itemSpecifics: itemSpecifics?.itemSpecifics || [],
    compatibility: compatibility?.compatibility || [],
    listingContent,
  };

  const messages = [
    { role: 'system', content: `You are a fact-checker for automotive parts listings.
Verify every claim against source data. Flag anything unsupported or hallucinated.

Return ONLY valid JSON:
{
  "supportedClaims": [{"field": "", "value": "", "evidence": "", "verdict": "supported"}],
  "unsupportedClaims": [{"field": "", "value": "", "reason": "", "severity": "low|medium|high|critical"}],
  "conflictingClaims": [{"field": "", "values": [], "recommendation": ""}],
  "hallucinationFlags": [{"field": "", "claim": "", "evidence": "", "risk": "low|medium|high|critical"}],
  "missingMandatory": [],
  "overallAssessment": {
    "hallucinationRisk": "low|medium|high|critical",
    "dataQuality": "poor|fair|good|excellent",
    "readyToPublish": true/false,
    "summary": ""
  }
}` },
    { role: 'user', content: `Verify this enrichment output against source data.

--- SOURCE DATA ---
${JSON.stringify(sourceData, null, 2)}

--- ENRICHMENT OUTPUT ---
${JSON.stringify(enrichmentOutput, null, 2).substring(0, 6000)}` }
  ];

  const raw = await callOpenRouter(MODELS.validation, messages, 4096);
  const result = extractJson(raw);
  const assessment = result.overallAssessment || {};
  console.log(`  Hallucination risk: ${assessment.hallucinationRisk || '?'}`);
  console.log(`  Data quality: ${assessment.dataQuality || '?'}`);
  console.log(`  Ready to publish: ${assessment.readyToPublish ?? '?'}`);
  console.log(`  Supported: ${(result.supportedClaims || []).length} | Unsupported: ${(result.unsupportedClaims || []).length} | Conflicts: ${(result.conflictingClaims || []).length}`);
  return result;
}

// ── Stage 7: Quality Control ───────────────────────────────────────────────
function stageQualityControl(itemSpecifics, compatibility, validation) {
  console.log('\n[Stage 7/7] Quality Control...');

  const assessment = validation?.overallAssessment || {};
  const specs = itemSpecifics?.itemSpecifics || [];
  const compat = compatibility?.compatibility || [];

  const specConfidences = specs.map(s => s.confidence || 0);
  const compatConfidences = compat.map(c => c.confidence || 0);
  const allConfidences = [...specConfidences, ...compatConfidences];
  const avgConfidence = allConfidences.length > 0
    ? allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
    : 0;

  let confidence = avgConfidence;
  if (assessment.hallucinationRisk === 'critical') confidence = Math.min(confidence, 0.2);
  else if (assessment.hallucinationRisk === 'high') confidence = Math.min(confidence, 0.4);
  else if (assessment.hallucinationRisk === 'medium') confidence = Math.min(confidence, 0.65);

  let routingDecision;
  if (confidence >= 0.90) routingDecision = 'auto_publish';
  else if (confidence >= 0.75) routingDecision = 'publish_with_warning';
  else if (confidence >= 0.50) routingDecision = 'secondary_ai_review';
  else if (confidence >= 0.30) routingDecision = 'human_review';
  else routingDecision = 'reject';

  const unsupported = validation?.unsupportedClaims || [];
  const manualReview = routingDecision === 'human_review' || routingDecision === 'reject'
    || unsupported.some(u => u.severity === 'critical');

  console.log(`  Overall confidence: ${(confidence * 100).toFixed(1)}%`);
  console.log(`  Routing decision: ${routingDecision}`);
  console.log(`  Manual review: ${manualReview}`);

  return {
    overallConfidence: confidence,
    routingDecision,
    conflicts: validation?.conflictingClaims || [],
    missingCriticalFields: validation?.missingMandatory || [],
    unsupportedClaims: unsupported.map(u => `${u.field}: ${u.value}`),
    manualReviewRequired: manualReview,
    manualReviewReasons: manualReview ? ['See validation report'] : [],
    validationReport: {
      supportedClaims: (validation?.supportedClaims || []).length,
      unsupportedClaims: unsupported.length,
      conflictingClaims: (validation?.conflictingClaims || []).length,
      missingMandatory: validation?.missingMandatory || [],
      marketplaceViolations: [],
      fieldsRequiringReview: [],
    },
  };
}

// ── Assemble final result ──────────────────────────────────────────────────
function assembleResult(part, imageAnalysis, itemSpecifics, compatibility, diagram, listingContent, validation, qualityControl) {
  const evidence = [];
  if (part.brand) evidence.push({ field: 'brand', value: part.brand, source: 'seller', confidence: 0.95 });
  if (part.manufacturerPartNumber) evidence.push({ field: 'partNumber', value: part.manufacturerPartNumber, source: 'seller', confidence: 0.9 });
  if (imageAnalysis?.brand) evidence.push({ field: 'brand', value: imageAnalysis.brand, source: 'image', confidence: 0.8 });
  if (imageAnalysis?.partNumbers?.length) evidence.push({ field: 'partNumber', value: imageAnalysis.partNumbers[0], source: 'image', confidence: 0.85 });

  return {
    inputSummary: {
      title: part.title,
      category: part.partType || 'Unknown',
      condition: part.qualityTier || 'USED',
      identifiers: [
        part.manufacturerPartNumber ? `MPN:${part.manufacturerPartNumber}` : null,
        ...(part.oeNumbers || []).map(n => `OE:${n}`),
      ].filter(Boolean),
      imagesAnalyzed: (part.imageUrls || []).length,
    },
    productIdentification: {
      productName: part.title,
      brand: part.brand || '',
      partNumber: part.manufacturerPartNumber || part.oeNumbers?.[0] || '',
      identificationStatus: part.brand && part.manufacturerPartNumber ? 'confirmed' : 'probable',
      confidence: part.brand && part.manufacturerPartNumber ? 0.92 : 0.7,
      evidence,
    },
    itemSpecifics: itemSpecifics?.itemSpecifics || [],
    compatibility: compatibility?.compatibility || [],
    listingContent: listingContent || {},
    diagram: {
      recommendedDiagramType: diagram?.diagramType || 'annotated_photo',
      imageGenerationPrompt: diagram?.prompt || '',
      negativePrompt: diagram?.negativePrompt || '',
      labels: diagram?.labels || [],
      verifiedClaimsOnly: true,
      outputFormat: { aspectRatio: '1:1', width: 2000, height: 2000 },
    },
    qualityControl,
    modelUsage: usage.map(u => ({
      stage: 'pipeline',
      openRouterModelId: u.model,
      reasonSelected: 'Balanced pipeline',
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      estimatedCostUsd: u.cost,
    })),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== PartsBazar360 BMW Listing Enrichment — Balanced Pipeline ===');
  console.log(`OpenRouter model pipeline: ${Object.values(MODELS).map(m => m.id).join(' → ')}`);
  console.log('');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('Fetching one unenriched BMW part...');
    const part = await fetchOneBmwPart(pool);
    if (!part) {
      console.log('No unenriched BMW parts found.');
      return;
    }

    console.log(`\nPart: ${part.title}`);
    console.log(`Brand: ${part.brand || 'unknown'}`);
    console.log(`MPN: ${part.manufacturerPartNumber || 'unknown'}`);
    console.log(`OE Numbers: ${(part.oeNumbers || []).join(', ')}`);
    console.log(`Images: ${(part.imageUrls || []).length}`);
    console.log(`Compatibility rows: ${Array.isArray(part.compatibility) ? part.compatibility.length : 0}`);

    const startTime = Date.now();

    // Run pipeline stages
    const imageAnalysis = await stageImageAnalysis(part);
    const itemSpecifics = await stageItemSpecifics(part, imageAnalysis);
    const compatibility = await stageCompatibility(part, imageAnalysis);
    const diagram = await stageDiagramPrompt(part, imageAnalysis, itemSpecifics);
    const listingContent = await stageTitleDescription(part, itemSpecifics, compatibility);
    const validation = await stageValidation(part, imageAnalysis, itemSpecifics, compatibility, listingContent);
    const qualityControl = stageQualityControl(itemSpecifics, compatibility, validation);

    // Assemble result
    const result = assembleResult(part, imageAnalysis, itemSpecifics, compatibility, diagram, listingContent, validation, qualityControl);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Save to DB
    console.log('\nSaving to database...');
    await pool.query(
      `UPDATE "CanonicalPart"
       SET "itemSpecifics" = $1,
           "enrichedAt" = NOW(),
           "enrichmentSource" = $3,
           "updatedAt" = NOW()
       WHERE id = $2`,
      [JSON.stringify(result.itemSpecifics), part.id, 'pipeline:balanced:gpt-4.1-mini'],
    );

    console.log('\n=== RESULTS ===');
    console.log(JSON.stringify(result, null, 2));

    console.log(`\n=== SUMMARY ===`);
    console.log(`Part ID: ${part.id}`);
    console.log(`Time: ${elapsed}s`);
    console.log(`Total cost: $${totalCost.toFixed(4)}`);
    console.log(`API calls: ${usage.length}`);
    console.log(`Confidence: ${(qualityControl.overallConfidence * 100).toFixed(1)}%`);
    console.log(`Decision: ${qualityControl.routingDecision}`);
    console.log(`Item specifics: ${(result.itemSpecifics || []).length} fields`);
    console.log(`Compatibility: ${(result.compatibility || []).length} rows`);
    console.log(`\nModel usage breakdown:`);
    for (const u of usage) {
      console.log(`  ${u.model}: ${u.inputTokens} in + ${u.outputTokens} out = $${u.cost.toFixed(4)}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
