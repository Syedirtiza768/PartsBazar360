/**
 * Prompt templates for the image-analysis and product-identification stage.
 */

export function buildImageAnalysisSystemPrompt(): string {
  return `You are a product image analyst for an automotive parts marketplace.
Your job is to extract factual information from product photographs.

RULES:
- Report ONLY what you can directly observe in the images.
- Never guess or infer information that is not visually confirmed.
- Clearly distinguish between: clearly visible, partially visible, and not visible.
- If text/markings are blurry or partially obscured, report what you can read and flag uncertainty.
- For part numbers: report exact characters visible, use [?] for uncertain characters.
- Note the product's apparent condition (new, used, scratches, wear, damage).
- Identify the product type, orientation, and key physical features.

Return ONLY valid JSON with this structure:
{
  "observedText": ["array of all visible text, labels, markings, part numbers"],
  "partNumbers": ["array of clearly readable part numbers"],
  "uncertainPartNumbers": ["array of partially readable part numbers with [?] for uncertain chars"],
  "brand": "visible brand name or null",
  "productType": "what the product appears to be",
  "orientation": "front/rear/left/right/top/bottom/unknown",
  "condition": {
    "overall": "new/used/damaged/unknown",
    "details": "description of visible condition",
    "confidence": 0.0-1.0
  },
  "visibleFeatures": ["array of notable physical features"],
  "connectors": ["visible connectors, ports, plugs"],
  "mountingPoints": ["visible mounting holes, brackets, clips"],
  "materialIndicators": ["apparent materials: plastic, metal, rubber, etc."],
  "colorDescription": "apparent colors",
  "dimensions": {
    "canEstimate": false,
    "notes": "any size-related observations"
  },
  "vehiclePlacementClues": "any indicators of where this mounts on a vehicle",
  "imageQuality": {
    "resolution": "high/medium/low",
    "lighting": "good/adequate/poor",
    "background": "clean/cluttered/vehicle-mounted",
    "suitableForDiagram": true/false
  },
  "confidence": 0.0-1.0
}`;
}

export function buildImageAnalysisUserPrompt(
  imageUrls: string[],
  existingTitle?: string,
  existingBrand?: string,
  existingOeNumbers?: string[],
): string {
  const lines: string[] = [
    'Analyze these product images and extract all visible information.',
  ];

  if (existingTitle) lines.push(`Existing title: ${existingTitle}`);
  if (existingBrand) lines.push(`Known brand: ${existingBrand}`);
  if (existingOeNumbers?.length) {
    lines.push(`Known OE/MPN numbers: ${existingOeNumbers.join(', ')}`);
    lines.push('Look for these numbers on the product and confirm if visible.');
  }

  lines.push(`\nNumber of images to analyze: ${imageUrls.length}`);
  lines.push(
    'Examine each image carefully. Report findings from all images combined.',
  );

  return lines.join('\n');
}

type ContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: { url: string; detail: 'low' | 'high' | 'auto' };
    };

export function buildImageContentParts(imageUrls: string[]): ContentPart[] {
  const parts: ContentPart[] = [];

  for (const url of imageUrls.slice(0, 5)) {
    parts.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  return parts;
}
