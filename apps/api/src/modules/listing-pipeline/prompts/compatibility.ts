/**
 * Prompt templates for fitment and compatibility verification.
 */

export function buildCompatibilitySystemPrompt(): string {
  return `You are an automotive fitment specialist verifying part-to-vehicle compatibility.

RULES:
- Compatibility must NOT be inferred solely because another listing uses the same keywords.
- Normalize OEM numbers: remove harmless spaces/dots/hyphens, preserve original.
- Verify whether the number identifies: exact part, part family, superseded part, interchangeable part, or incomplete casting number.
- Separate CONFIRMED compatibility from POSSIBLE compatibility.
- Do NOT claim universal compatibility without strong evidence.
- Do NOT generate broad year ranges without verification.
- Record engine, trim, body, market, production-date, and connector restrictions.
- Flag situations where VIN verification is recommended.
- Keep marketplace compatibility rows separate from general item specifics.

Return ONLY valid JSON:
{
  "compatibility": [
    {
      "make": "string",
      "model": "string",
      "yearFrom": number or null,
      "yearTo": number or null,
      "trim": "string or empty",
      "engine": "string or empty",
      "bodyStyle": "string or empty",
      "market": "string or empty (e.g., US, EU, GCC, JP)",
      "notes": "string - restrictions, production date cutoffs, connector variants",
      "confidence": 0.0-1.0,
      "verificationStatus": "verified | probable | unverified | conflicting"
    }
  ],
  "partNumberAnalysis": {
    "normalizedOem": "cleaned OEM number",
    "originalOem": "original OEM number as provided",
    "numberType": "exact_part | part_family | superseded | interchangeable | casting_number | unknown",
    "supersedes": ["older part numbers this replaces"],
    "supersededBy": ["newer part numbers that replace this"],
    "interchangeNumbers": ["known cross-reference numbers"],
    "notes": "analysis notes"
  },
  "fitmentWarnings": ["any warnings about compatibility claims"],
  "recommendedVerification": ["steps buyers should take to verify fitment"]
}`;
}

export function buildCompatibilityUserPrompt(input: {
  title?: string;
  brand?: string;
  oeNumbers?: string[];
  manufacturerPartNumber?: string;
  compatibility?: Array<Record<string, unknown>>;
  vehicleInfo?: Record<string, unknown>;
  imageAnalysis?: Record<string, unknown>;
}): string {
  const lines: string[] = ['Verify fitment and compatibility for this part:\n'];

  if (input.title) lines.push(`Title: ${input.title}`);
  if (input.brand) lines.push(`Brand: ${input.brand}`);
  if (input.manufacturerPartNumber)
    lines.push(`MPN: ${input.manufacturerPartNumber}`);
  if (input.oeNumbers?.length)
    lines.push(`OE Numbers: ${input.oeNumbers.join(', ')}`);

  if (input.vehicleInfo) {
    const vi = input.vehicleInfo;
    lines.push('\n--- Seller-Declared Vehicle ---');
    if (vi.make) lines.push(`Make: ${String(vi.make)}`);
    if (vi.model) lines.push(`Model: ${String(vi.model)}`);
    if (vi.yearFrom) lines.push(`Year From: ${String(vi.yearFrom)}`);
    if (vi.yearTo) lines.push(`Year To: ${String(vi.yearTo)}`);
    if (vi.trim) lines.push(`Trim: ${String(vi.trim)}`);
    if (vi.engine) lines.push(`Engine: ${String(vi.engine)}`);
  }

  if (input.compatibility?.length) {
    lines.push(
      `\n--- Existing Compatibility Data (${input.compatibility.length} rows) ---`,
    );
    const sample = input.compatibility.slice(0, 10);
    for (const row of sample) {
      const parts = [
        row.make,
        row.model,
        row.year,
        row.trim,
        row.engine,
      ].filter(Boolean);
      lines.push(`  ${parts.join(' ')}`);
    }
    if (input.compatibility.length > 10) {
      lines.push(`  ... and ${input.compatibility.length - 10} more rows`);
    }
  }

  if (input.imageAnalysis) {
    const ia = input.imageAnalysis;
    if (ia.partNumbers)
      lines.push(
        `\nPart numbers from images: ${(ia.partNumbers as string[]).join(', ')}`,
      );
    if (ia.vehiclePlacementClues)
      lines.push(
        `Vehicle placement clues: ${String(ia.vehiclePlacementClues)}`,
      );
  }

  return lines.join('\n');
}
