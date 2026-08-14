import type { CompatibilityRow, TitleChecks } from "./types";

export const SEO_TITLE_TEMPLATE = "Brand | Short description | OE number | Fits Make Model";
export const SEO_TITLE_MAX_LENGTH = 160;

interface SeoTitleInput {
  title: string;
  brand: string;
  manufacturer: string;
  titleBrand?: string;
  manufacturerPartNumber: string;
  oemPartNumber: string;
  category?: string;
  productType?: string;
  originalTitle?: string;
  suggestedTitle?: string;
  compatibility: CompatibilityRow[];
  universalFitment: boolean;
  sourceCompatibilityReady?: boolean;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function includesValue(container: string, value: string) {
  const normalizedValue = normalize(value);
  return normalizedValue.length > 0 && normalize(container).includes(normalizedValue);
}

function isPlaceholder(value: string) {
  return /\b(needed|missing|unknown|tbd|n\/?a)\b/i.test(value);
}

function isUsefulDescription(value: string) {
  const normalized = normalize(value);
  return (
    value.trim().length >= 3 &&
    value.trim().length <= 80 &&
    /[a-z]/i.test(value) &&
    !isPlaceholder(value) &&
    !/^(auto motive )?(replacement )?parts?$/.test(normalized) &&
    normalized !== "general automotive parts"
  );
}

export function assessSeoTitle(input: SeoTitleInput): TitleChecks {
  const sections = input.title.split("|").map((section) => section.trim());
  const format = sections.length === 4 && sections.every(Boolean);
  const [brandSection = "", descriptionSection = "", oeSection = "", fitmentSection = ""] = sections;
  const acceptedBrands = [input.titleBrand, input.brand, input.manufacturer]
    .filter((value): value is string => Boolean(value))
    .filter((value) => !/^(unknown|oe|oem|genuine oem|aftermarket|n\/?a)$/i.test(value));
  const brand = format && (acceptedBrands.length > 0
    ? acceptedBrands.some((value) => normalize(brandSection) === normalize(value))
    : normalize(brandSection) === "unbranded");
  const description = format && isUsefulDescription(descriptionSection);
  const oeNumber = format && (input.oemPartNumber.trim().length > 0
    ? !isPlaceholder(oeSection) && includesValue(oeSection, input.oemPartNumber)
    : /^oe\s+(?:not\s+available|not\s+verified)$/i.test(oeSection));

  const verifiedFitment = input.compatibility.some(
    (row) =>
      row.make.trim().length > 0 &&
      row.model.trim().length > 0 &&
      includesValue(fitmentSection, row.make) &&
      includesValue(fitmentSection, row.model),
  );
  const summarizedSourceFitment =
    input.sourceCompatibilityReady === true &&
    /\bfits?\b/i.test(fitmentSection) &&
    !isPlaceholder(fitmentSection) &&
    normalize(fitmentSection).split(" ").length >= 3;
  const fitment = format && (input.universalFitment
    ? /\buniversal\b/i.test(fitmentSection)
    : verifiedFitment || summarizedSourceFitment || (
        input.compatibility.length === 0 &&
        input.sourceCompatibilityReady !== true &&
        /^fitment\s+not\s+confirmed$/i.test(fitmentSection)
      ));
  const concise = input.title.trim().length >= 20 && input.title.trim().length <= SEO_TITLE_MAX_LENGTH;
  const complete = format && brand && description && oeNumber && fitment && concise;

  return { format, brand, description, oeNumber, fitment, concise, complete };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanDescriptionCandidate(value: string, input: SeoTitleInput) {
  let candidate = value.trim();
  if (!candidate) return "";
  const piped = candidate.split("|").map((part) => part.trim());
  candidate = piped.length === 4 && isUsefulDescription(piped[1] || "")
    ? piped[1] || ""
    : piped[0] || "";

  for (const removable of [input.brand, input.manufacturer]) {
    if (removable.trim()) {
      candidate = candidate.replace(new RegExp(`^${escapeRegExp(removable.trim())}\\s*`, "i"), "");
    }
  }
  for (const removable of [input.manufacturerPartNumber, input.oemPartNumber]) {
    if (removable.trim()) {
      candidate = candidate.replace(new RegExp(escapeRegExp(removable.trim()), "gi"), "");
    }
  }
  candidate = candidate
    .replace(/\b(genuine\s+oem|aftermarket|auto(?:motive)?\s+part|replacement\s+part)\b/gi, " ")
    .replace(/[–—-]+\s*$/g, "")
    .replace(/^[–—:\s-]+|[–—:\s-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return isUsefulDescription(candidate) ? candidate : "";
}

function uniqueFitments(rows: CompatibilityRow[]) {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of rows) {
    const make = row.make.trim();
    const model = row.model.trim();
    if (!make || !model) continue;
    const key = `${normalize(make)}:${normalize(model)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(`${make} ${model}`);
  }
  return values;
}

export function buildSeoTitle(input: SeoTitleInput) {
  const sourceBrand = input.titleBrand?.trim() || input.brand.trim() || input.manufacturer.trim();
  const brand = sourceBrand && !/^(unknown|oe|oem|genuine oem|aftermarket|n\/?a)$/i.test(sourceBrand)
    ? sourceBrand
    : "Unbranded";
  const candidates = [
    input.title,
    input.productType || "",
    input.originalTitle || "",
    input.suggestedTitle || "",
    input.category || "",
  ];
  const baseDescription =
    candidates.map((candidate) => cleanDescriptionCandidate(candidate, input)).find(Boolean) ||
    "Unclassified Automotive Part";
  const mpn = input.manufacturerPartNumber.trim();
  let description = `${baseDescription} ${mpn}`.trim();
  const oe = input.oemPartNumber.trim() ? `OE ${input.oemPartNumber.trim()}` : "OE not available";
  const allFitments = uniqueFitments(input.compatibility);
  let selectedFitments = allFitments.slice(0, 3);

  const fitmentLabel = () => {
    if (input.universalFitment) return "Universal fit";
    if (selectedFitments.length === 0) return "Fitment not confirmed";
    const remaining = allFitments.length - selectedFitments.length;
    return `Fits ${selectedFitments.join(", ")}${remaining > 0 ? ` +${remaining} models` : ""}`;
  };
  const compose = () => `${brand} | ${description} | ${oe} | ${fitmentLabel()}`;
  while (selectedFitments.length > 1 && compose().length > SEO_TITLE_MAX_LENGTH) {
    selectedFitments = selectedFitments.slice(0, -1);
  }
  if (description.length > 80 || compose().length > SEO_TITLE_MAX_LENGTH) {
    const fixedLength = `${brand} |  | ${oe} | ${fitmentLabel()}`.length;
    const maximumDescription = Math.min(
      80,
      Math.max(mpn.length + 2, SEO_TITLE_MAX_LENGTH - fixedLength),
    );
    const maximumStem = Math.max(1, maximumDescription - mpn.length - (mpn ? 1 : 0));
    const clipped = baseDescription.slice(0, maximumStem + 1);
    const lastSpace = clipped.lastIndexOf(" ");
    const stem = clipped.slice(0, lastSpace >= Math.floor(maximumStem * 0.6) ? lastSpace : maximumStem).trim();
    description = `${stem} ${mpn}`.trim();
  }
  return compose();
}
