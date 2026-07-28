/**
 * Prompt templates for the item-specifics extraction stage.
 */

export function buildItemSpecificsSystemPrompt(): string {
  return `You are an automotive parts catalog specialist generating marketplace item specifics.

TASK: Generate comprehensive eBay Motors / marketplace item specifics from the provided product data.

RULES:
- Return ONLY valid JSON. No markdown fences, no explanation text.
- For each field: specify value, evidence source, and confidence (0.0-1.0).
- Evidence hierarchy (strongest to weakest):
  1. Seller-provided factual data
  2. Clearly readable markings on the actual product (from image analysis)
  3. Official manufacturer catalog
  4. Official marketplace taxonomy
  5. Reliable OEM or authorized distributor catalog
  6. Trusted fitment database
  7. Reputable third-party references
  8. Visual inference
  9. Model inference
- Fields based only on weak inference (level 8-9) must have autoPublish=false.
- Never invent OEM numbers, compatibility, dimensions, certifications, or warranty.
- If a field cannot be determined, use null value and mark as unverified.
- Normalize OEM numbers: remove harmless spaces/dots/hyphens, preserve original.

SCHEMA:
{
  "itemSpecifics": [
    {
      "field": "string - field name",
      "value": "string or null",
      "normalizedValue": "string or null - cleaned/normalized version",
      "source": "seller | image | manufacturer | marketplace | external_database | inference",
      "confidence": 0.0-1.0,
      "verificationStatus": "verified | probable | unverified | conflicting",
      "autoPublish": true/false,
      "alternativeValues": ["other possible values if ambiguous"],
      "reason": "brief explanation of how this value was determined"
    }
  ],
  "productClassification": {
    "partType": "specific part type",
    "vehicleSystem": "major vehicle system (Body & Frame, Engine, Drivetrain, Electrical, Suspension & Brakes, Interior, HVAC, Exhaust, Fuel System, Cooling System, Steering, Lighting, Safety, Accessories)",
    "categoryType": "specific category grouping"
  }
}

FIELDS TO GENERATE (include all that are relevant):
- Brand
- Manufacturer Part Number (MPN)
- OE/OEM Part Number
- Interchange Part Number
- Other Part Number
- Product Type / Part Type
- Model
- Product Line
- Material
- Color
- Finish / Surface Finish
- Size
- Dimensions (only if verified)
- Weight (only if verified)
- Features
- Condition
- Condition Description
- Country/Region of Manufacture
- Manufacturer Warranty
- Universal Fitment (boolean)
- Vintage Part (boolean)
- Performance Part (boolean)
- Custom Bundle (boolean)
- Modified Item (boolean)
- Unit Quantity
- Unit Type
- Placement on Vehicle
- Position (Driver Side / Passenger Side / Center / Left / Right / Front / Rear)

FOR AUTOMOTIVE PARTS ALSO CONSIDER:
- Front/Rear/Left/Right/Upper/Lower/Inner/Outer position
- Vehicle Make, Model, Year Range, Trim, Engine, Transmission, Body Style
- Connector count, Pin count, Sensor type, Housing type
- Lens color, Bulb type, Mounting style
- Vehicle system, Category type`;
}

export function buildItemSpecificsUserPrompt(input: {
  title?: string;
  brand?: string;
  manufacturerPartNumber?: string;
  oeNumbers?: string[];
  category?: string;
  condition?: string;
  sellerNotes?: string;
  description?: string;
  partSource?: string;
  qualityTier?: string;
  imageAnalysis?: Record<string, unknown>;
  compatibility?: Array<Record<string, unknown>>;
}): string {
  const lines: string[] = [
    'Generate item specifics for this product listing:\n',
  ];

  if (input.title) lines.push(`Title: ${input.title}`);
  if (input.brand) lines.push(`Brand: ${input.brand}`);
  if (input.manufacturerPartNumber)
    lines.push(`MPN: ${input.manufacturerPartNumber}`);
  if (input.oeNumbers?.length)
    lines.push(`OE Numbers: ${input.oeNumbers.join(', ')}`);
  if (input.category) lines.push(`Category: ${input.category}`);
  if (input.condition) lines.push(`Condition: ${input.condition}`);
  if (input.partSource) lines.push(`Part Source: ${input.partSource}`);
  if (input.qualityTier) lines.push(`Quality Tier: ${input.qualityTier}`);
  if (input.sellerNotes)
    lines.push(`Seller Notes: ${input.sellerNotes.substring(0, 500)}`);
  if (input.description)
    lines.push(`Description: ${input.description.substring(0, 500)}`);

  if (input.imageAnalysis) {
    const ia = input.imageAnalysis;
    lines.push('\n--- Image Analysis Results ---');
    if (ia.observedText)
      lines.push(`Observed text: ${(ia.observedText as string[]).join(', ')}`);
    if (ia.partNumbers)
      lines.push(
        `Part numbers from images: ${(ia.partNumbers as string[]).join(', ')}`,
      );
    if (ia.brand) lines.push(`Brand from images: ${String(ia.brand)}`);
    if (ia.productType)
      lines.push(`Product type from images: ${String(ia.productType)}`);
    if (ia.visibleFeatures)
      lines.push(
        `Visible features: ${(ia.visibleFeatures as string[]).join(', ')}`,
      );
    if (ia.connectors)
      lines.push(`Connectors: ${(ia.connectors as string[]).join(', ')}`);
    if (ia.mountingPoints)
      lines.push(
        `Mounting points: ${(ia.mountingPoints as string[]).join(', ')}`,
      );
    if (ia.materialIndicators)
      lines.push(
        `Materials: ${(ia.materialIndicators as string[]).join(', ')}`,
      );
    if (ia.condition) {
      const c = ia.condition as Record<string, unknown>;
      lines.push(
        `Condition from images: ${String(c.overall)} - ${String(c.details)}`,
      );
    }
  }

  if (input.compatibility?.length) {
    const sample = input.compatibility.slice(0, 5);
    const fitmentStr = sample
      .map((f) => [f.make, f.model, f.year].filter(Boolean).join(' '))
      .join('; ');
    const more =
      input.compatibility.length > 5
        ? ` (${input.compatibility.length} total)`
        : '';
    lines.push(`\nFitment${more}: ${fitmentStr}`);
  }

  return lines.join('\n');
}
