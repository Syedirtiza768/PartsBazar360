export interface Offer {
  id: string;
  price: number;
  currency?: string;
  condition: string;
  sellerId?: string;
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
  compatibility?: any;
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
