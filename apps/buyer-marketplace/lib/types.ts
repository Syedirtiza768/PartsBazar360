export interface Offer {
  id: string;
  price: number;
  currency?: string;
  condition: string;
  partSource?: string;
  qualityTier?: string;
  sellerId?: string;
  sellerName?: string;
  seller?: { id: string; name: string };
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

export interface Part {
  id: string;
  title: string;
  brand?: string | null;
  manufacturer?: string | null;
  category?: string | null;
  oeNumbers?: string[];
  imageUrls?: string[];
  listingUrl?: string | null;
  ebayItemId?: string | null;
  compatibility?: CompatibilityRow[] | any;
  compatibilityTable?: CompatibilityRow[];
  partSource?: string;
  qualityTier?: string;
  fitmentStatus?: string;
  fitmentConfidence?: number | null;
  createdAt?: string;
  minPrice?: number | null;
  fitments?: string[];
  compatibleVehicles?: CompatibleVehicle[];
  offers: Offer[];
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
