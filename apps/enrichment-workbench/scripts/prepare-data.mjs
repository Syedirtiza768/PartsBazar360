/* global process, Buffer */
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const WORK_DIR = path.join(REPO_ROOT, "tmp", "superior-enrichment-workbench");
const INDEX_PATH = path.join(WORK_DIR, "catalog.jsonl");
const META_PATH = path.join(WORK_DIR, "catalog-meta.json");
const COMPATIBILITY_INDEX_PATH = path.join(WORK_DIR, "compatibility.jsonl");
const COMPATIBILITY_OFFSETS_PATH = path.join(WORK_DIR, "compatibility-offsets.json");
const OE_COMPATIBILITY_INDEX_PATH = path.join(WORK_DIR, "oe-compatibility-index.json");
const MPN_COMPATIBILITY_INDEX_PATH = path.join(WORK_DIR, "mpn-compatibility-index.json");
const LUNA_ENRICHMENT_PATH = path.join(WORK_DIR, "mpn-luna-enrichment.jsonl");
const INDEX_VERSION = 8;

const SOURCE_PATH = path.join(REPO_ROOT, "active_listings_superior_auto_parts_active_from_server.csv");
const SEO_TITLE_PATH = path.join(REPO_ROOT, "active_listings_superior_auto_parts_seo_optimized.csv");
const TITLE_PATH = path.join(REPO_ROOT, "exports", "superior_listings_enriched.csv");
const IMAGE_PATH = path.join(
  REPO_ROOT,
  "outputs",
  "superior_all_active_for_ai_images-ai-enriched-validated.csv",
);
const COMPATIBILITY_PATH = path.join(
  REPO_ROOT,
  "outputs",
  "superior_active_with_images_luna_input_v2.csv",
);

const INPUTS = [SOURCE_PATH, SEO_TITLE_PATH, TITLE_PATH, IMAGE_PATH, COMPATIBILITY_PATH, LUNA_ENRICHMENT_PATH].filter(existsSync);

async function cacheIsFresh() {
  if (
    !existsSync(INDEX_PATH) ||
    !existsSync(META_PATH) ||
    !existsSync(COMPATIBILITY_INDEX_PATH) ||
    !existsSync(COMPATIBILITY_OFFSETS_PATH) ||
    !existsSync(OE_COMPATIBILITY_INDEX_PATH) ||
    !existsSync(MPN_COMPATIBILITY_INDEX_PATH)
  ) return false;
  const meta = JSON.parse(await readFile(META_PATH, "utf8"));
  if (meta.indexVersion !== INDEX_VERSION) return false;
  const indexStat = await stat(INDEX_PATH);
  for (const input of INPUTS) {
    if ((await stat(input)).mtimeMs > indexStat.mtimeMs) return false;
  }
  return true;
}

function text(value) {
  return String(value ?? "").trim();
}

function splitUrls(value) {
  return [...new Set(text(value).split(/\s*[|;\n]\s*/).filter((url) => /^https?:\/\//i.test(url)))];
}

function normalizePartNumber(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeBrand(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function mpnLookupKeys(brand, manufacturer, manufacturerPartNumber) {
  const mpn = normalizePartNumber(manufacturerPartNumber);
  if (!mpn) return [];
  return [...new Set([brand, manufacturer]
    .map(normalizeBrand)
    .filter(Boolean)
    .map((normalizedBrand) => `${normalizedBrand}|${mpn}`))];
}

function splitPartNumbers(value) {
  return [...new Set(text(value).split(/\s*[|;,\n]\s*/).map((item) => item.replace(/^#+/, "").trim()).filter(Boolean))];
}

function isPlausiblePartNumber(value) {
  const normalized = normalizePartNumber(value);
  return normalized.length >= 5 && /\d/.test(normalized) && !/^(UNKNOWN|MISSING|NONE|NA)$/.test(normalized);
}

function mpnLookupKey(brand, mpn) {
  const normalizedBrand = normalizeBrand(brand);
  const normalizedMpn = normalizePartNumber(mpn);
  return normalizedBrand && normalizedMpn ? `${normalizedBrand}|${normalizedMpn}` : "";
}

async function readLunaEnrichment() {
  if (!existsSync(LUNA_ENRICHMENT_PATH)) return new Map();
  const map = new Map();
  const raw = await readFile(LUNA_ENRICHMENT_PATH, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.key && row.status === "ok") map.set(row.key, row);
    } catch {
      // Ignore a partial final line so a resumable Luna run can continue safely.
    }
  }
  return map;
}

function isUsefulBrand(value) {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return Boolean(normalized) && !/^(unknown|oe|oem|genuine oem|aftermarket|na|n a)$/.test(normalized);
}

function resolveTitleBrand(listing, knownBrands) {
  const direct = [listing.brand, listing.manufacturer].find(isUsefulBrand);
  if (direct) return text(direct);
  const title = text(listing.originalTitle || listing.suggestedTitle).toUpperCase();
  const inferred = knownBrands.find((brand) => {
    const normalizedBrand = brand.toUpperCase();
    return title === normalizedBrand || title.startsWith(`${normalizedBrand} `) || title.startsWith(`${normalizedBrand} |`);
  });
  return inferred || "Unbranded";
}

function escapeRegExp(value) {
  return text(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usefulDescription(value) {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return text(value).length >= 3 && /[a-z]/i.test(value) &&
    !/^(auto motive )?(replacement )?parts?$/.test(normalized) &&
    normalized !== "general automotive parts";
}

function cleanDescriptionCandidate(value, listing) {
  let candidate = text(value);
  if (!candidate) return "";
  const piped = candidate.split("|").map(text);
  candidate = piped.length === 4 && usefulDescription(piped[1])
    ? piped[1]
    : piped[0];
  for (const removable of [listing.brand, listing.manufacturer]) {
    if (text(removable)) candidate = candidate.replace(new RegExp(`^${escapeRegExp(removable)}\\s*`, "i"), "");
  }
  for (const removable of [listing.manufacturerPartNumber, listing.oemPartNumber]) {
    if (text(removable)) candidate = candidate.replace(new RegExp(escapeRegExp(removable), "gi"), "");
  }
  candidate = candidate
    .replace(/\b(genuine\s+oem|aftermarket|auto(?:motive)?\s+part|replacement\s+part)\b/gi, " ")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return usefulDescription(candidate) ? candidate : "";
}

function summarizeFitments(rows) {
  const seen = new Set();
  const labels = [];
  for (const row of rows) {
    const make = text(row.make);
    const model = text(row.model);
    if (!make || !model) continue;
    const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (labels.length < 3) labels.push(`${make} ${model}`);
  }
  return { labels, count: seen.size };
}

function lunaKeyForListing(listing) {
  const mpn = text(listing.manufacturerPartNumber || listing.sellerSku);
  return [listing.brand, listing.manufacturer, listing.titleBrand]
    .map((brand) => mpnLookupKey(brand, mpn))
    .find(Boolean) || "";
}

function applyLunaResult(listing, result) {
  if (!result || listing.existingCompatibilityReady) return;
  const identityConfidence = Number(result.identityConfidence || 0);
  const fitmentConfidence = Number(result.fitmentConfidence || 0);
  if (identityConfidence < 0.85) return;
  const description = cleanDescriptionCandidate(result.productDescription, listing);
  if (description) {
    listing.titleDescriptionOverride = description;
    listing.lunaDescriptionApplied = true;
  }
  const oeNumber = Array.isArray(result.oeNumbers)
    ? result.oeNumbers.map(text).find(isPlausiblePartNumber)
    : "";
  if (!listing.oemPartNumber && oeNumber) {
    listing.oemPartNumber = oeNumber;
    listing.lunaOeRecovered = true;
  }
  const fitment = Array.isArray(result.fitment)
    ? result.fitment.filter((row) => text(row?.make) && text(row?.model) && /^(?:19|20)\d{2}$/.test(text(row?.yearStart)) && /^(?:19|20)\d{2}$/.test(text(row?.yearEnd)))
    : [];
  if (fitmentConfidence < 0.85 || fitment.length === 0) return;
  const fitmentSummary = summarizeFitments(fitment);
  listing._lunaCompatibility = fitment;
  listing._titleFitments = fitmentSummary.labels;
  listing._titleFitmentCount = fitmentSummary.count;
  listing.existingCompatibilityCount = fitment.length;
  listing.existingCompatibilityReady = true;
  listing.compatibilitySourceCanonicalPartId = listing.canonicalPartId || "";
  listing.lunaFitmentApplied = true;
}
function oeCandidatesForRow(row) {
  const manufacturerPartNumber = text(row.manufacturer_part_number);
  const isOemPart = [text(row.part_type), text(row.part_source)]
    .some((value) => /^(GENUINE_OEM|OEM)$/i.test(value));
  const candidates = [
    ...splitPartNumbers(row.genuine_oem_part_number),
    ...splitPartNumbers(row.oe_numbers),
    ...(isOemPart ? [manufacturerPartNumber] : []),
  ].filter((candidate) => {
    if (!isPlausiblePartNumber(candidate)) return false;
    return isOemPart || normalizePartNumber(candidate) !== normalizePartNumber(manufacturerPartNumber);
  });
  return [...new Set(candidates)];
}

function truncateAtWord(value, maximum) {
  if (value.length <= maximum) return value;
  const clipped = value.slice(0, maximum + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return clipped.slice(0, lastSpace >= Math.floor(maximum * 0.6) ? lastSpace : maximum).trim();
}

function buildBulkSeoTitle(listing) {
  const brand = text(listing.titleBrand) || "Unbranded";
  const mpn = text(listing.manufacturerPartNumber || listing.sellerSku);
  const candidates = [
    listing.titleDescriptionOverride,
    listing.productType,
    listing.suggestedTitle,
    listing.originalTitle,
    listing.category,
  ];
  const baseDescription = candidates
    .map((candidate) => cleanDescriptionCandidate(candidate, listing))
    .find(Boolean) || "Unclassified Automotive Part";
  let description = `${baseDescription} ${mpn}`.trim();
  const oe = listing.oemPartNumber ? `OE ${listing.oemPartNumber}` : "OE not available";
  const allFitments = listing._titleFitments || [];
  let selectedFitments = allFitments.slice(0, 3);
  const fitmentLabel = () => {
    if (selectedFitments.length === 0) return "Fitment not confirmed";
    const remaining = Math.max(0, (listing._titleFitmentCount || selectedFitments.length) - selectedFitments.length);
    return `Fits ${selectedFitments.join(", ")}${remaining > 0 ? ` +${remaining} models` : ""}`;
  };
  const compose = () => `${brand} | ${description} | ${oe} | ${fitmentLabel()}`;
  while (selectedFitments.length > 1 && compose().length > 160) selectedFitments = selectedFitments.slice(0, -1);
  if (description.length > 80 || compose().length > 160) {
    const fixedLength = `${brand} |  | ${oe} | ${fitmentLabel()}`.length;
    const maximumDescription = Math.min(80, Math.max(mpn.length + 2, 160 - fixedLength));
    const maximumStem = Math.max(1, maximumDescription - mpn.length - (mpn ? 1 : 0));
    description = `${truncateAtWord(baseDescription, maximumStem)} ${mpn}`.trim();
  }
  return compose();
}

function makeCompatibilityRow(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const yearValue = raw.year ?? raw.years ?? raw.modelYear ?? raw.model_year ?? "";
  const yearRange = text(yearValue).match(/(19|20)\d{2}(?:\s*[-–]\s*((?:19|20)\d{2}))?/);
  const yearStart = text(
    raw.yearStart ?? raw.startYear ?? raw.fromYear ?? raw.year_from ?? raw.yearMin ?? yearRange?.[0]?.slice(0, 4),
  );
  const yearEnd = text(
    raw.yearEnd ?? raw.endYear ?? raw.toYear ?? raw.year_to ?? raw.yearMax ?? yearRange?.[2] ?? yearStart,
  );
  const make = text(raw.make ?? raw.vehicleMake ?? raw.manufacturer ?? raw.brand);
  const model = text(raw.model ?? raw.vehicleModel ?? raw.series);
  const trim = text(raw.trim ?? raw.variant ?? raw.submodel ?? raw.subModel);
  const engine = text(raw.engine ?? raw.engineType ?? raw.engine_code ?? raw.engineCode ?? raw.displacement);
  const notes = text(raw.notes ?? raw.note ?? raw.fitmentNotes ?? raw.description ?? raw.qualifier);
  if (![yearStart, yearEnd, make, model, trim, engine, notes].some(Boolean)) return null;
  return {
    id: `source-fitment-${index}`,
    yearStart,
    yearEnd,
    make,
    model,
    trim,
    engine,
    notes,
  };
}

function extractCompatibility(value) {
  if (!text(value)) return [];
  try {
    const parsed = JSON.parse(value);
    let rows = parsed;
    if (!Array.isArray(rows) && rows && typeof rows === "object") {
      rows =
        rows.compatibility ??
        rows.fitments ??
        rows.vehicles ??
        rows.items ??
        rows.rows ??
        rows.applications ??
        [];
    }
    if (!Array.isArray(rows)) return [];
    return rows.map(makeCompatibilityRow).filter(Boolean);
  } catch {
    return [];
  }
}

async function parseCsv(filePath, onRow) {
  if (!existsSync(filePath)) return 0;
  const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let headers = null;
  let row = [];
  let field = "";
  let quoted = false;
  let pendingQuote = false;
  let count = 0;

  const emitRow = () => {
    if (row.length === 0 && field.length === 0) return;
    row.push(field);
    field = "";
    if (!headers) {
      headers = row.map((header) => header.replace(/^\uFEFF/, "").trim());
    } else if (row.some((value) => value.length > 0)) {
      const record = {};
      for (let index = 0; index < headers.length; index += 1) record[headers[index]] = row[index] ?? "";
      onRow(record, count);
      count += 1;
    }
    row = [];
  };

  for await (const chunk of stream) {
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index];
      if (pendingQuote) {
        if (character === '"') {
          field += '"';
          pendingQuote = false;
          continue;
        }
        quoted = false;
        pendingQuote = false;
      }
      if (quoted) {
        if (character === '"') pendingQuote = true;
        else field += character;
        continue;
      }
      if (character === '"' && field.length === 0) {
        quoted = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        emitRow();
      } else if (character !== "\r") {
        field += character;
      }
    }
  }
  if (pendingQuote) quoted = false;
  emitRow();
  return count;
}

async function main() {
  if (!existsSync(SOURCE_PATH)) {
    throw new Error(`Superior source export not found: ${SOURCE_PATH}`);
  }
  await mkdir(WORK_DIR, { recursive: true });
  if (await cacheIsFresh()) {
    const meta = JSON.parse(await readFile(META_PATH, "utf8"));
    process.stdout.write(`Superior catalogue is ready (${meta.totalListings.toLocaleString()} listings).\n`);
    return;
  }

  process.stdout.write("Preparing the Superior catalogue…\n");
  const listings = new Map();
  const lunaEnrichment = await readLunaEnrichment();
  await parseCsv(SOURCE_PATH, (row) => {
    if (text(row.seller_name).toLowerCase() !== "superior auto parts") return;
    const listingId = text(row.listing_id);
    if (!listingId) return;
    listings.set(listingId, {
      listingId,
      canonicalPartId: "",
      sellerName: text(row.seller_name),
      originalTitle: text(row.title).replaceAll("â€“", "–").replaceAll("â€”", "—"),
      suggestedTitle: "",
      brand: text(row.brand),
      manufacturer: text(row.manufacturer),
      manufacturerPartNumber: text(row.mfr_part_number),
      oemPartNumber: text(row.oem_part_number),
      category: text(row.category),
      productType: "",
      systemCategory: "",
      partType: text(row.part_type),
      condition: text(row.condition),
      price: text(row.price),
      currency: text(row.currency),
      sourceTag: text(row.source_tag),
      sellerSku: text(row.seller_sku),
      sourceUpdatedAt: text(row.updated_at),
      currentImageUrls: [],
      candidateImages: [],
      existingCompatibility: [],
      existingCompatibilityCount: 0,
      existingCompatibilityReady: false,
      compatibilityNote: "",
    });
  });

  await parseCsv(SEO_TITLE_PATH, (row) => {
    const listing = listings.get(text(row.listing_id));
    if (!listing) return;
    listing.suggestedTitle = text(row.seo_title);
  });

  await parseCsv(TITLE_PATH, (row) => {
    const listing = listings.get(text(row.listing_id));
    if (!listing) return;
    listing.suggestedTitle = text(row.enriched_title).replaceAll("â€“", "–").replaceAll("â€”", "—");
    listing.productType = text(row.inferred_product_type);
    listing.systemCategory = text(row.inferred_system_category);
    listing.compatibilityNote = text(row.compatibility_note);
  });

  const byCanonicalPartId = new Map();
  await parseCsv(IMAGE_PATH, (row) => {
    const listing = listings.get(text(row.listing_id));
    if (!listing) return;
    listing.canonicalPartId = text(row.canonical_part_id);
    listing.currentImageUrls = splitUrls(row.current_image_urls);
    const candidateUrl = text(row.found_image_url);
    if (candidateUrl) {
      listing.candidateImages.push({
        url: candidateUrl,
        sourceUrl: text(row.image_source_url),
        status: text(row.image_lookup_status),
        confidence: text(row.image_match_confidence),
        reason: text(row.image_match_reason),
        validation: text(row.image_url_validation),
      });
    }
    if (listing.canonicalPartId) {
      const matches = byCanonicalPartId.get(listing.canonicalPartId) || [];
      matches.push(listing);
      byCanonicalPartId.set(listing.canonicalPartId, matches);
    }
  });

  if (existsSync(COMPATIBILITY_PATH)) {
    process.stdout.write("Merging existing images and compatibility…\n");
    const temporaryCompatibilityPath = `${COMPATIBILITY_INDEX_PATH}.tmp`;
    const compatibilityOutput = createWriteStream(temporaryCompatibilityPath, { encoding: "utf8" });
    const compatibilityOffsets = {};
    const oeCompatibilityIndex = {};
    const mpnCompatibilityIndex = {};
    let compatibilityOffset = 0;
    await parseCsv(COMPATIBILITY_PATH, (row) => {
      const canonicalPartId = text(row.canonical_part_id);
      const matches = byCanonicalPartId.get(canonicalPartId) || [];
      const compatibility = extractCompatibility(row.compatibility_json);
      const imageUrls = splitUrls(row.image_urls);
      const confidence = Number(row.fitment_confidence || 0);
      const confirmed =
        text(row.fitment_status).toUpperCase() === "CONFIRMED" &&
        confidence >= 0.85 &&
        compatibility.some((item) => item.yearStart && item.make && item.model);
      const oeCandidates = oeCandidatesForRow(row);
      const fitmentSummary = summarizeFitments(compatibility);
      if (compatibility.length > 0) {
        const serialized = `${JSON.stringify({ canonicalPartId, compatibility })}\n`;
        const byteLength = Buffer.byteLength(serialized, "utf8");
        compatibilityOffsets[canonicalPartId] = { offset: compatibilityOffset, length: byteLength };
        compatibilityOutput.write(serialized);
        compatibilityOffset += byteLength;

        if (confirmed) {
          for (const candidate of oeCandidates) {
            const normalized = normalizePartNumber(candidate);
            oeCompatibilityIndex[normalized] ??= {
              canonicalPartId,
              oeNumber: candidate,
              sourceTitle: text(row.title),
              fitmentStatus: text(row.fitment_status),
              confidence,
            };
          }
          const manufacturerPartNumber = text(row.manufacturer_part_number);
          if (isPlausiblePartNumber(manufacturerPartNumber)) {
            for (const key of mpnLookupKeys(row.brand, row.manufacturer, manufacturerPartNumber)) {
              mpnCompatibilityIndex[key] ??= {
                canonicalPartId,
                brand: text(row.brand || row.manufacturer),
                manufacturerPartNumber,
                oeNumber: oeCandidates[0] || "",
                sourceTitle: text(row.title),
                fitmentStatus: text(row.fitment_status),
                confidence,
                fitmentLabels: fitmentSummary.labels,
                fitmentCount: fitmentSummary.count,
              };
            }
          }
        }
      }
      for (const listing of matches) {
        if (listing.currentImageUrls.length === 0 && imageUrls.length > 0) listing.currentImageUrls = imageUrls;
        listing.existingCompatibilityCount = compatibility.length;
        listing.existingCompatibilityReady = confirmed;
        if (confirmed) {
          listing.compatibilitySourceCanonicalPartId = canonicalPartId;
          listing._titleFitments = fitmentSummary.labels;
          listing._titleFitmentCount = fitmentSummary.count;
          if (!listing.oemPartNumber && oeCandidates[0]) listing.oemPartNumber = oeCandidates[0];
        }
      }
    });
    for (const listing of listings.values()) {
      if (listing.existingCompatibilityReady) continue;
      const match = mpnLookupKeys(
        listing.brand,
        listing.manufacturer,
        listing.manufacturerPartNumber,
      ).map((key) => mpnCompatibilityIndex[key]).find(Boolean);
      if (!match) continue;
      listing.compatibilitySourceCanonicalPartId = match.canonicalPartId;
      listing.existingCompatibilityCount = match.fitmentCount;
      listing.existingCompatibilityReady = true;
      listing._titleFitments = match.fitmentLabels;
      listing._titleFitmentCount = match.fitmentCount;
      if (!listing.oemPartNumber && match.oeNumber) listing.oemPartNumber = match.oeNumber;
    }
    const lunaSerialized = new Set();
    for (const listing of listings.values()) {
      if (!listing.existingCompatibilityReady) applyLunaResult(listing, lunaEnrichment.get(lunaKeyForListing(listing)));
      const compatibility = listing._lunaCompatibility;
      if (!compatibility?.length || !listing.canonicalPartId || lunaSerialized.has(listing.canonicalPartId)) continue;
      const serialized = `${JSON.stringify({ canonicalPartId: listing.canonicalPartId, compatibility })}\n`;
      const byteLength = Buffer.byteLength(serialized, "utf8");
      compatibilityOffsets[listing.canonicalPartId] = { offset: compatibilityOffset, length: byteLength };
      compatibilityOutput.write(serialized);
      compatibilityOffset += byteLength;
      lunaSerialized.add(listing.canonicalPartId);
    }
    await new Promise((resolve, reject) => {
      compatibilityOutput.on("error", reject);
      compatibilityOutput.end(resolve);
    });
    const { rename } = await import("node:fs/promises");
    await rename(temporaryCompatibilityPath, COMPATIBILITY_INDEX_PATH);
    await writeFile(COMPATIBILITY_OFFSETS_PATH, JSON.stringify(compatibilityOffsets), "utf8");
    await writeFile(OE_COMPATIBILITY_INDEX_PATH, JSON.stringify(oeCompatibilityIndex), "utf8");
    await writeFile(MPN_COMPATIBILITY_INDEX_PATH, JSON.stringify(mpnCompatibilityIndex), "utf8");
  } else {
    await writeFile(COMPATIBILITY_INDEX_PATH, "", "utf8");
    await writeFile(COMPATIBILITY_OFFSETS_PATH, "{}", "utf8");
    await writeFile(OE_COMPATIBILITY_INDEX_PATH, "{}", "utf8");
    await writeFile(MPN_COMPATIBILITY_INDEX_PATH, "{}", "utf8");
  }

  for (const listing of listings.values()) {
    if (!listing.existingCompatibilityReady) applyLunaResult(listing, lunaEnrichment.get(lunaKeyForListing(listing)));
  }

  const values = [...listings.values()];
  const lunaFitmentTitles = values.filter((listing) => listing.lunaFitmentApplied).length;
  const lunaDescriptionTitles = values.filter((listing) => listing.lunaDescriptionApplied).length;
  const lunaOeRecovered = values.filter((listing) => listing.lunaOeRecovered).length;
  const knownBrands = [...new Set(values.flatMap((listing) => [listing.brand, listing.manufacturer])
    .filter(isUsefulBrand)
    .map(text))].sort((left, right) => right.length - left.length);
  for (const listing of values) {
    listing.titleBrand = resolveTitleBrand(listing, knownBrands);
    listing.suggestedTitle = buildBulkSeoTitle(listing);
    delete listing._titleFitments;
    delete listing._titleFitmentCount;
    delete listing._lunaCompatibility;
    delete listing.titleDescriptionOverride;
    delete listing.lunaFitmentApplied;
    delete listing.lunaDescriptionApplied;
    delete listing.lunaOeRecovered;
  }
  const temporaryIndex = `${INDEX_PATH}.tmp`;
  const output = createWriteStream(temporaryIndex, { encoding: "utf8" });
  for (const listing of values) output.write(`${JSON.stringify(listing)}\n`);
  await new Promise((resolve, reject) => {
    output.on("error", reject);
    output.end(resolve);
  });
  const { rename } = await import("node:fs/promises");
  await rename(temporaryIndex, INDEX_PATH);

  const titleSuggestions = values.filter((listing) => listing.suggestedTitle).length;
  const meta = {
    indexVersion: INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(REPO_ROOT, SOURCE_PATH).replaceAll("\\", "/"),
    totalListings: values.length,
    titleSuggestions,
    listingsWithImages: values.filter((listing) => listing.currentImageUrls.length > 0).length,
    listingsWithCompatibility: values.filter((listing) => listing.existingCompatibilityCount > 0).length,
    titlesWithOe: values.filter((listing) => Boolean(listing.oemPartNumber)).length,
    titlesWithConfirmedFitment: values.filter((listing) => listing.existingCompatibilityReady).length,
    titlesWithLunaFitment: lunaFitmentTitles,
    titlesWithLunaDescription: lunaDescriptionTitles,
    lunaOeRecovered,
    lunaEnrichmentRecords: lunaEnrichment.size,
    titlesUsingOeFallback: values.filter((listing) => !listing.oemPartNumber).length,
    titlesUsingFitmentFallback: values.filter((listing) => !listing.existingCompatibilityReady).length,
    titlesMatchedByBrandMpn: values.filter((listing) =>
      listing.compatibilitySourceCanonicalPartId &&
      listing.compatibilitySourceCanonicalPartId !== listing.canonicalPartId).length,
    oeCompatibilityLookups: Object.keys(
      JSON.parse(await readFile(OE_COMPATIBILITY_INDEX_PATH, "utf8")),
    ).length,
    mpnCompatibilityLookups: Object.keys(
      JSON.parse(await readFile(MPN_COMPATIBILITY_INDEX_PATH, "utf8")),
    ).length,
  };
  await writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  process.stdout.write(
    `Ready: ${meta.totalListings.toLocaleString()} listings, ${meta.listingsWithImages.toLocaleString()} with images, ${meta.listingsWithCompatibility.toLocaleString()} with compatibility.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
