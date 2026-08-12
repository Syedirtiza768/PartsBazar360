/**
 * The PDP's "Technical details" table.
 *
 * This is presentation, not SEO: it decides which catalog fields are worth a
 * visible row and how they are labelled. It used to live inside the SEO view
 * model, which meant a display tweak and a metadata rule shared one file; the
 * SEO engine now owns metadata/schema/indexability and this owns the table.
 *
 * The two still agree on substance because both read the same catalog fields —
 * the engine's `specificationProperties` emits the same values as JSON-LD
 * `additionalProperty`, which is exactly the "markup matches the page"
 * property Google requires.
 */

import {
  isMeaningfulBrand,
  meaningfulBrand,
  partTypeFromLegacy,
  titleCase,
} from "@repo/catalog-contracts";
import { humanize } from "@/lib/format";
import { brandPath, categoryPath } from "@repo/catalog-contracts";
import type { Part } from "@/lib/types";

export interface ProductSpecification {
  label: string;
  value: string;
  /** Set when the value is a taxonomy term with its own landing page. */
  href?: string;
  /** Provenance, when the enrichment pipeline recorded one. */
  source?: string;
  confidence?: number;
  verified?: boolean;
  /** Render in the monospace part-number style. */
  monospace?: boolean;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeIdentifier(value: unknown): string {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Build the visible spec rows for a part.
 *
 * Every row is conditional on its source field: a listing missing a material
 * simply has no Material row rather than an empty one. Nothing is inferred —
 * if the catalog does not record it, the table does not claim it.
 */
export function productSpecifications(part: Part): ProductSpecification[] {
  const specifics = part.itemSpecifics ?? {};
  const mpn =
    text(part.manufacturerPartNumber) || text((part.oeNumbers ?? [])[0]) || "";

  const resolvedPartType = partTypeFromLegacy(
    part.partSource || part.offers?.[0]?.partSource,
    part.partType || part.offers?.[0]?.partType,
  );
  const qualityTier = part.qualityTier || part.offers?.[0]?.qualityTier;
  const partSource = part.partSource || part.offers?.[0]?.partSource;

  const rows: Array<Omit<ProductSpecification, "value"> & { value: unknown }> = [
    {
      label: "Category",
      value: part.category,
      ...(part.category ? { href: categoryPath(part.category) } : {}),
    },
    {
      label: "Product type",
      value: specifics.inferredProductType || specifics.productType,
    },
    {
      // A part-source label sitting in the brand column ("Genuine OEM",
      // "ORIGINAL") is shown as Part source elsewhere, and must never link to
      // a brand landing page that does not legitimately exist.
      label: "Brand",
      value: meaningfulBrand(part.brand),
      ...(isMeaningfulBrand(part.brand) ? { href: brandPath(part.brand) } : {}),
    },
    {
      label: "Manufacturer",
      value:
        part.manufacturer && part.manufacturer !== part.brand
          ? part.manufacturer
          : null,
    },
    { label: "Manufacturer part number", value: mpn, monospace: true },
    {
      // Genuine OEM parts carry their condition in the badge and the OEM
      // clause; repeating a "Quality tier: USED" row next to a Genuine OEM
      // badge reads as a contradiction, so it is suppressed there.
      label: "Condition",
      value:
        resolvedPartType === "GENUINE_OEM"
          ? null
          : qualityTier
            ? humanize(qualityTier)
            : null,
    },
    {
      label: "Part source",
      value: partSource
        ? partSource === "OEM"
          ? "OEM"
          : humanize(partSource)
        : null,
    },
    { label: "Position", value: part.position || specifics.position },
    {
      label: "Vehicle system",
      value: part.vehicleSystem || specifics.vehicleSystem,
    },
    { label: "Material", value: part.material || specifics.material },
    { label: "Part type", value: specifics.partType },
    { label: "Placement", value: specifics.placementOnVehicle },
    { label: "Color", value: specifics.color },
    { label: "Brand type", value: specifics.brandType },
    { label: "Surface finish", value: specifics.surfaceFinish },
    { label: "Country of origin", value: specifics.countryOfOrigin },
    { label: "Warranty", value: specifics.warranty },
    { label: "Category type", value: specifics.categoryType },
    {
      label: "Features",
      value: Array.isArray(specifics.features)
        ? specifics.features.join(", ")
        : specifics.features,
    },
  ];

  const built: ProductSpecification[] = rows
    .map((row) => {
      const evidence =
        part.provenance?.[row.label] || part.provenance?.[row.label.toLowerCase()];
      return {
        ...row,
        value: text(row.value),
        ...(evidence?.source ? { source: evidence.source } : { source: "catalog" }),
        ...(evidence?.confidence != null ? { confidence: evidence.confidence } : {}),
        ...(evidence?.verified !== undefined ? { verified: evidence.verified } : {}),
      } as ProductSpecification;
    })
    .filter((row) => Boolean(row.value));

  // OE numbers get their own row, but only the ones that are not just the MPN
  // written with different separators — otherwise the table shows the same
  // number twice under two labels.
  const normalizedMpn = normalizeIdentifier(mpn);
  const seen = new Set<string>();
  const oeNumbers = (part.oeNumbers ?? [])
    .map((value) => text(value))
    .filter((value) => {
      const key = normalizeIdentifier(value);
      if (!key || key === normalizedMpn || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (oeNumbers.length) {
    const evidence =
      part.provenance?.["OE numbers"] || part.provenance?.["oeNumbers"];
    const insertAfter = built.findIndex(
      (row) => row.label === "Manufacturer part number",
    );
    built.splice(insertAfter + 1, 0, {
      label: "OE numbers",
      value: oeNumbers.join(", "),
      monospace: true,
      source: evidence?.source ?? "catalog",
      ...(evidence?.confidence != null ? { confidence: evidence.confidence } : {}),
      ...(evidence?.verified !== undefined ? { verified: evidence.verified } : {}),
    });
  }

  return built.map((row) => ({
    ...row,
    monospace:
      row.monospace || row.label.toLowerCase().includes("number") || undefined,
    value: row.label === "Category" || row.label === "Brand"
      ? titleCase(row.value)
      : row.value,
  }));
}
