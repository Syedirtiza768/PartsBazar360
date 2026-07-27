/**
 * Enrich CanonicalPart records with structured itemSpecifics via MiMo v2.5 Pro (OpenRouter).
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... node scripts/enrich-itemspecifics.mjs
 *   ENRICH_LIMIT=50 node scripts/enrich-itemspecifics.mjs
 *   ENRICH_VEHICLES="Toyota Corolla,BMW 335i,Dodge Charger" node scripts/enrich-itemspecifics.mjs
 *   ENRICH_DRY_RUN=1 node scripts/enrich-itemspecifics.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY is required');
  process.exit(1);
}

const MODEL = process.env.ENRICH_MODEL || 'xiaomi/mimo-v2.5-pro';
const LIMIT = process.env.ENRICH_LIMIT ? Number(process.env.ENRICH_LIMIT) : null;
const DRY_RUN = process.env.ENRICH_DRY_RUN === '1';
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS || 200);
const CONCURRENCY = Math.max(1, Number(process.env.ENRICH_CONCURRENCY || 5));
const VEHICLES = (process.env.ENRICH_VEHICLES || 'Toyota Corolla,BMW 335i,Dodge Charger')
  .split(',')
  .map((v) => v.trim());

const SYSTEM_PROMPT = `You are an automotive parts catalog specialist for a used OEM auto parts marketplace.
Given listing data for a used auto part, generate standardized eBay Motors item specifics as valid JSON.

RULES:
- Return ONLY valid JSON. No markdown fences, no explanation text.
- Infer placement from title keywords (front/rear/left/right/driver/passenger/upper/lower/inner/outer).
- Infer material from part type (fenders=steel, mirrors=plastic+glass, gaskets=rubber, hoses=rubber/silicone, brackets=steel/aluminum, etc.).
- If the part is used OEM: brandType="OEM Genuine", condition="Used", warranty="No Warranty".
- If brand is missing, try to infer from OE number patterns or vehicle make.
- vehicleSystem: classify into one of: Body & Frame, Engine, Drivetrain, Electrical, Suspension & Brakes, Interior, HVAC, Exhaust, Fuel System, Cooling System, Steering, Lighting, Safety, Accessories.
- categoryType: a more specific grouping like Body Parts, Engine Components, Brake Parts, Electrical Components, Interior Trim, etc.
- For used parts: surfaceFinish is usually "As-Is" or "Normal Wear" unless the title specifies otherwise.
- isPerformancePart, isCustomBundle, isModifiedItem, isUniversalFitment are booleans.
- features: array of notable features if any (e.g. ["Heated", "Power Adjustable", "Fog Light"]).
- If a field cannot be determined, use null.

SCHEMA:
{
  "partType": "string - specific part type (e.g. Fender, Brake Caliper, Alternator, Headlight Assembly)",
  "placementOnVehicle": "string - physical location (e.g. Front Left, Rear Right, Upper)",
  "position": "string - Driver Side / Passenger Side / Center / Left / Right / Front / Rear",
  "material": "string - primary material (Steel, Aluminum, Plastic, Rubber, Glass, Carbon Fiber, etc.)",
  "color": "string - color if mentioned or typical for part type",
  "features": ["string array - notable features"],
  "countryOfOrigin": "string - if determinable from brand/vehicle",
  "warranty": "string - typically No Warranty for used parts",
  "condition": "Used | New | Remanufactured | Refurbished",
  "brandType": "OEM Genuine | Aftermarket | Performance | Remanufactured",
  "surfaceFinish": "string - Painted, Chrome, Raw, As-Is, etc.",
  "isPerformancePart": boolean,
  "isCustomBundle": boolean,
  "isModifiedItem": boolean,
  "isUniversalFitment": boolean,
  "OE_numbers": ["string array - OEM part numbers from the data"],
  "supersedes": ["string array - superseded part numbers if any"],
  "interchangeNumbers": ["string array - interchange/cross-reference numbers"],
  "vehicleSystem": "string - major vehicle system",
  "categoryType": "string - specific category grouping"
}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildUserPrompt(part) {
  const lines = [`Title: ${part.title}`];
  if (part.brand) lines.push(`Brand: ${part.brand}`);
  if (part.manufacturerPartNumber) lines.push(`MPN: ${part.manufacturerPartNumber}`);
  if (part.oeNumbers?.length) lines.push(`OE Numbers: {${part.oeNumbers.join(', ')}}`);

  // Sample first 3 fitment rows
  const compat = Array.isArray(part.compatibility) ? part.compatibility : [];
  const totalRows = compat.length;
  if (totalRows > 0) {
    const sample = compat.slice(0, 3);
    const fitmentStr = sample
      .map((f) => {
        const parts = [f.make, f.model, f.year];
        if (f.trim && f.trim !== '-') parts.push(f.trim);
        if (f.engine && f.engine !== '-') parts.push(f.engine);
        return parts.join(' ');
      })
      .join('; ');
    const more = totalRows > 3 ? ` (${totalRows} total fitments)` : '';
    lines.push(`Fitment${more}: ${fitmentStr}`);
  }

  if (part.description) {
    const desc = part.description.substring(0, 500);
    lines.push(`Description: ${desc}`);
  }

  return lines.join('\n');
}

async function callOpenRouter(userPrompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://partsbazar360.com',
      'X-Title': 'PartsBazar360 Item Specifics Enrichment',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body}`);
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;

  // MiMo v2.5 Pro is a reasoning model — content may be in `reasoning` field
  // when max_tokens is consumed by thinking before content is generated.
  let rawText = msg?.content?.trim() || msg?.reasoning?.trim() || '';

  if (!rawText) {
    console.error('  [DEBUG] No content or reasoning in response:', JSON.stringify(data).substring(0, 500));
    throw new Error('Empty response from OpenRouter');
  }

  // Strip markdown fences if present
  let cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Try to extract JSON object if there's surrounding text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('  [DEBUG] Failed to parse:', cleaned.substring(0, 300));
    throw e;
  }
}

async function fetchParts(pool) {
  const vehicleConditions = VEHICLES.map((v) => {
    const [make, ...modelParts] = v.split(' ');
    const model = modelParts.join(' ');
    return `(elem->>'make' = '${make.replace(/'/g, "''")}' AND elem->>'model' = '${model.replace(/'/g, "''")}')`;
  }).join(' OR ');

  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';

  const query = `
    SELECT cp.id, cp.title, cp.brand, cp."manufacturerPartNumber",
      cp."oeNumbers", cp.description, cp.compatibility, cp."partType",
      cp.position, cp."vehicleSystem"
    FROM "CanonicalPart" cp
    JOIN "SellerOffer" so ON cp.id = so."canonicalPartId"
    JOIN "Seller" s ON so."sellerId" = s.id
    WHERE so.status = 'ACTIVE'
      AND s."onboardingStatus" = 'ACTIVE'
      AND so."sellerId" != 'seed-febest-inventory-supplier'
      AND so.price > 0
      AND cp.compatibility IS NOT NULL
      AND jsonb_typeof(cp.compatibility) = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(cp.compatibility) elem
        WHERE ${vehicleConditions}
      )
    ORDER BY cp.title
    ${limitClause}
  `;

  const result = await pool.query(query);
  return result.rows;
}

async function main() {
  console.log('=== PartsBazar360 Item Specifics Enrichment ===');
  console.log(`Model: ${MODEL}`);
  console.log(`Vehicles: ${VEHICLES.join(', ')}`);
  console.log(`Limit: ${LIMIT || 'all'}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log('');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('Fetching parts...');
    const parts = await fetchParts(pool);
    console.log(`Found ${parts.length} parts to enrich\n`);

    if (parts.length === 0) {
      console.log('No parts found. Check ENRICH_VEHICLES format.');
      return;
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;
    const errors = [];
    const startTime = Date.now();

    // Process in batches
    for (let i = 0; i < parts.length; i += CONCURRENCY) {
      const batch = parts.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (part) => {
          const userPrompt = buildUserPrompt(part);

          if (DRY_RUN) {
            console.log(`[DRY] ${part.title.substring(0, 70)}`);
            return { partId: part.id, result: { dryRun: true } };
          }

          const itemSpecifics = await callOpenRouter(userPrompt);

          await pool.query(
            `UPDATE "CanonicalPart" SET "itemSpecifics" = $1, "updatedAt" = NOW() WHERE id = $2`,
            [JSON.stringify(itemSpecifics), part.id],
          );

          return { partId: part.id, result: itemSpecifics };
        }),
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const part = batch[j];
        if (r.status === 'fulfilled') {
          success++;
          const spec = r.value.result;
          const pos = spec.position || '-';
          const sys = spec.vehicleSystem || '-';
          const pt = spec.partType || '-';
          console.log(
            `[${i + j + 1}/${parts.length}] ✓ ${part.title.substring(0, 55).padEnd(55)} → ${pt} | ${pos} | ${sys}`,
          );
        } else {
          failed++;
          errors.push({ id: part.id, title: part.title, error: r.reason?.message });
          console.log(`[${i + j + 1}/${parts.length}] ✗ ${part.title.substring(0, 55)} → ${r.reason?.message?.substring(0, 80)}`);
        }
      }

      if (i + CONCURRENCY < parts.length) {
        await sleep(DELAY_MS);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=== Results ===`);
    console.log(`Total: ${parts.length}`);
    console.log(`Success: ${success}`);
    console.log(`Failed: ${failed}`);
    console.log(`Time: ${elapsed}s`);
    console.log(`Rate: ${(success / (elapsed / 60)).toFixed(0)} parts/min`);

    if (errors.length > 0) {
      console.log(`\n--- Errors ---`);
      for (const e of errors.slice(0, 10)) {
        console.log(`  ${e.title?.substring(0, 60)}: ${e.error?.substring(0, 100)}`);
      }
      if (errors.length > 10) console.log(`  ... and ${errors.length - 10} more`);
    }

    // Cost estimate (MiMo v2.5 Pro reasoning model uses ~1500 reasoning + 400 content tokens)
    const avgInputTokens = 950;
    const avgOutputTokens = 1800;
    const inputCost = (success * avgInputTokens * 0.348) / 1_000_000;
    const outputCost = (success * avgOutputTokens * 0.696) / 1_000_000;
    console.log(`\n--- Estimated Cost ---`);
    console.log(`Input:  ~$${inputCost.toFixed(2)} (${success} × ${avgInputTokens} tokens × $0.348/1M)`);
    console.log(`Output: ~$${outputCost.toFixed(2)} (${success} × ${avgOutputTokens} tokens × $0.696/1M)`);
    console.log(`Total:  ~$${(inputCost + outputCost).toFixed(2)}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
