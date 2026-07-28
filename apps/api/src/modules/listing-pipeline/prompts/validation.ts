/**
 * Prompt templates for hallucination detection and validation.
 */

export function buildValidationSystemPrompt(): string {
  return `You are a fact-checker and hallucination detector for automotive parts listings.
Your job is to verify every generated claim against its cited evidence.

RULES:
- Compare EVERY claim in the enrichment output against the source data.
- Flag any claim that goes beyond what the evidence supports.
- Pay special attention to: OEM numbers, compatibility, dimensions, materials, certifications, warranty.
- A claim is UNSUPPORTED if it has no evidence in the source data.
- A claim is CONFLICTING if multiple source values disagree.
- A claim is HALLUCINATED if it was invented without any source basis.

NEVER mark a claim as supported if:
- It was inferred from "common knowledge" about the product category
- It was copied from a competitor listing without verification
- It adds features because they are "typical" for the part type
- Visual similarity was converted into confirmed product identification

Return ONLY valid JSON:
{
  "supportedClaims": [
    {
      "field": "field name",
      "value": "claimed value",
      "evidence": "what evidence supports this",
      "verdict": "supported"
    }
  ],
  "unsupportedClaims": [
    {
      "field": "field name",
      "value": "claimed value",
      "reason": "why this is unsupported",
      "severity": "low | medium | high | critical"
    }
  ],
  "conflictingClaims": [
    {
      "field": "field name",
      "values": [
        {"value": "value A", "source": "where it came from"},
        {"value": "value B", "source": "where it came from"}
      ],
      "recommendation": "which value to keep or flag for review"
    }
  ],
  "hallucinationFlags": [
    {
      "field": "field name",
      "claim": "what was claimed",
      "evidence": "what evidence exists (or lack thereof)",
      "risk": "low | medium | high | critical"
    }
  ],
  "missingMandatory": ["list of required marketplace fields that are missing"],
  "marketplaceViolations": ["any fields that violate marketplace formatting rules"],
  "fieldsRequiringReview": ["fields that need human review"],
  "overallAssessment": {
    "hallucinationRisk": "low | medium | high | critical",
    "dataQuality": "poor | fair | good | excellent",
    "readyToPublish": true/false,
    "summary": "brief assessment"
  }
}`;
}

export function buildValidationUserPrompt(
  sourceData: Record<string, unknown>,
  enrichmentOutput: Record<string, unknown>,
): string {
  return `Verify this enrichment output against the source data.

--- SOURCE DATA ---
${JSON.stringify(sourceData, null, 2).substring(0, 8000)}

--- ENRICHMENT OUTPUT ---
${JSON.stringify(enrichmentOutput, null, 2).substring(0, 8000)}

Check every claim. Flag anything unsupported, conflicting, or potentially hallucinated.`;
}
