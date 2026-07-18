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
  oeNumbers?: string[];
  fitmentFlags?: string[];
  imageUrls?: string[];
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
}

export interface BrowseResponse {
  items: Part[];
  total: number;
  page: number;
  limit: number;
}

export interface Facet {
  name: string;
  count: number;
}

export interface FacetsResponse {
  brands: Facet[];
  categories: Facet[];
}
