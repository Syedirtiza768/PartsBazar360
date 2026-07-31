export interface Offer {
  id: string;
  price: number;
  currency?: string | null;
  condition: string;
  partSource?: string;
  qualityTier?: string;
  sellerId?: string;
  sellerName?: string;
  partType?: string;
  sellerSku?: string | null;
  moq?: number;
  sourceTag?: string | null;
  inventory?: Array<{ quantity: number; status: string; warehouse?: { name: string; location?: string | null } }>;
  seller?: {
    id: string;
    name: string;
    profile?: SellerProfileSummary | null;
  };
}

export interface PartNumberRecord {
  displayNumber: string;
  normalizedNumber: string;
  numberType: string;
  make?: string | null;
  brand?: string | null;
}

export interface OemCrossReference {
  number: string;
  normalizedNumber: string;
  make?: string | null;
  verificationStatus?: string;
}

export interface SellerProfileSummary {
  country?: string | null;
  returnWindowDays?: number | null;
  acceptsReturns?: boolean | null;
  warrantyDays?: number | null;
  fulfillmentSlaHours?: number | null;
  shippingRegions?: string[];
}

export interface CompatibleVehicle {
  label: string;
  make: string;
  model: string;
  startYear: number | null;
  endYear: number | null;
  evidenceLevel: string;
  confidence: number;
}

export interface CompatibilityRow {
  year: number | string;
  make: string;
  model: string;
  trim?: string;
  engine?: string;
  notes?: string;
  source?: string;
  mvlVerified?: boolean;
  epid?: string | null;
}

/** Raw fitment relation as returned by the part detail endpoint. */
export interface PartFitment {
  id: string;
  vehicleConfigId: string;
  evidenceLevel: string;
  confidence: number;
  vehicleConfig?: {
    trim?: string | null;
    engine?: string | null;
    transmission?: string | null;
    generation?: {
      name: string;
      startYear?: number | null;
      endYear?: number | null;
      model?: { name: string; make?: { name: string } };
    };
  };
}

export interface ItemSpecifics {
  partType?: string | null;
  placementOnVehicle?: string | null;
  position?: string | null;
  material?: string | null;
  color?: string | null;
  features?: string | string[];
  countryOfOrigin?: string | null;
  warranty?: string | null;
  condition?: string | null;
  brandType?: string | null;
  surfaceFinish?: string | null;
  isPerformancePart?: boolean;
  isCustomBundle?: boolean;
  isModifiedItem?: boolean;
  isUniversalFitment?: boolean;
  OE_numbers?: string[];
  supersedes?: string[];
  interchangeNumbers?: string[];
  vehicleSystem?: string | null;
  categoryType?: string | null;
}

/**
 * Resolved shipping metrics for a part. Always present and always populated —
 * an unknown weight falls back to a part-class estimate server-side so the PDP
 * never has to render a spinner where a shipping figure belongs.
 *
 * `state` is 'exact' when both weight and dimensions are measured, 'pending'
 * while background enrichment is refining them, and 'estimated' otherwise.
 */
export interface PartShipping {
  state: "exact" | "estimated" | "pending";
  weightKg: number;
  billableWeightKg: number;
  volumetricWeightKg?: number | null;
  weightBasis: "ACTUAL" | "VOLUMETRIC";
  source: "SPREADSHEET" | "SELLER" | "MEASURED" | "SIBLING_MPN" | "AI" | "CLASS_DEFAULT";
  confidence?: number | null;
  partClassKey?: string;
  dimensionsCm?: { lengthCm: number; widthCm: number; heightCm: number } | null;
  dimensionsEstimated?: boolean;
  requiresFreightQuote: boolean;
  weightOutlier?: boolean;
  weightAutoConverted?: boolean;
}

export interface Part {
  id: string;
  title: string;
  brand?: string | null;
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
  partType?: string;
  partNumbers?: PartNumberRecord[];
  oemCrossReferences?: OemCrossReference[];
  category?: string | null;
  weight?: number | null;
  shipping?: PartShipping | null;
  enrichmentStatus?: string | null;
  enrichmentVersion?: number | null;
  oeNumbers?: string[];
  fitmentFlags?: string[];
  imageUrls?: string[];
  /**
   * Generated spec card for high-value parts, served as SVG from the API and
   * already hoisted to the front of `imageUrls`. Exposed separately so callers
   * can tell it apart from a seller photo.
   */
  infographicUrl?: string | null;
  infographicAlt?: string | null;
  locationDiagramUrl?: string | null;
  locationDiagramAlt?: string | null;
  listingUrl?: string | null;
  ebayItemId?: string | null;
  compatibility?: CompatibilityRow[];
  compatibilityTable?: CompatibilityRow[];
  partSource?: string;
  qualityTier?: string;
  fitmentStatus?: string;
  fitmentConfidence?: number | null;
  createdAt?: string;
  minPrice?: number | null;
  position?: string | null;
  vehicleSystem?: string | null;
  material?: string | null;
  itemSpecifics?: ItemSpecifics | null;
  /**
   * Search index documents carry verified vehicleConfig ids (string[]);
   * the part detail endpoint carries full fitment relations (PartFitment[]).
   */
  fitments?: Array<string | PartFitment>;
  compatibleVehicles?: CompatibleVehicle[];
  offers: Offer[];
  /**
   * Set by search when this result was found through an interchange /
   * analogue number rather than the part's own primary number. `matchedNumber`
   * echoes what the buyer searched, so the card can name it.
   */
  matchedVia?: "interchange";
  matchedNumber?: string;
  salvageUnits?: SalvageUnit[];
  sourceTags?: string[];
}

export interface SalvageUnit {
  id: string;
  originalOemNumber?: string | null;
  conditionGrade?: string | null;
  testedStatus?: string | null;
  damageNotes?: string | null;
  missingComponents?: string[];
  warranty?: string | null;
  dismantlingLocation?: string | null;
  shelfBin?: string | null;
  identityMethod?: string;
  donorVehicle?: {
    make?: string | null;
    model?: string | null;
    modelYear?: number | null;
    trim?: string | null;
    engine?: string | null;
    vinMasked?: string | null;
    mileage?: number | null;
    mileageUnit?: string | null;
    donorStockNumber?: string | null;
  } | null;
}

export interface BrowseFacets {
  brands: Facet[];
  categories: Facet[];
  makes: Facet[];
  partTypes: Facet[];
  sourceTags: Facet[];
}

export interface BrowseResponse {
  items: Part[];
  total: number;
  /** 'eq' = exact count; 'gte' = at least (only when a result window is hit). */
  totalRelation?: "eq" | "gte";
  page: number;
  limit: number;
  /** Highest page reachable by offset pagination (result window / page size). */
  maxPage?: number;
  /** Post-filter facets scoped to the active search/filters — consistent counts. */
  facets?: BrowseFacets;
}

export interface Facet {
  name: string;
  count: number;
}

export interface FacetsResponse {
  brands: Facet[];
  categories: Facet[];
  makes: Facet[];
  partTypes: Facet[];
  sourceTags: Facet[];
}
