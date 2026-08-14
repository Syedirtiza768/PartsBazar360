export type ReviewStatus = "unreviewed" | "draft" | "approved";

export interface CompatibilityRow {
  id: string;
  yearStart: string;
  yearEnd: string;
  make: string;
  model: string;
  trim: string;
  engine: string;
  notes: string;
}

export interface ImageCandidate {
  url: string;
  sourceUrl: string;
  status: string;
  confidence: string;
  reason: string;
  validation: string;
}

export interface SourceListing {
  listingId: string;
  canonicalPartId: string;
  sellerName: string;
  originalTitle: string;
  suggestedTitle: string;
  brand: string;
  titleBrand?: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  oemPartNumber: string;
  category: string;
  productType: string;
  systemCategory: string;
  partType: string;
  condition: string;
  price: string;
  currency: string;
  sourceTag: string;
  sellerSku: string;
  sourceUpdatedAt: string;
  currentImageUrls: string[];
  candidateImages: ImageCandidate[];
  existingCompatibility: CompatibilityRow[];
  existingCompatibilityCount: number;
  existingCompatibilityReady: boolean;
  compatibilitySourceCanonicalPartId?: string;
  compatibilityNote: string;
}

export interface ListingEdit {
  title?: string;
  oemPartNumber?: string;
  imageUrls?: string[];
  compatibility?: CompatibilityRow[];
  universalFitment?: boolean;
  reviewerNote?: string;
  status: ReviewStatus;
  updatedAt: string;
}

export interface TitleChecks {
  format: boolean;
  brand: boolean;
  description: boolean;
  oeNumber: boolean;
  fitment: boolean;
  concise: boolean;
  complete: boolean;
}

export interface ListingReadiness {
  title: boolean;
  titleChecks: TitleChecks;
  image: boolean;
  compatibility: boolean;
  ready: boolean;
}

export interface ListingSummary {
  listingId: string;
  title: string;
  originalTitle: string;
  brand: string;
  manufacturerPartNumber: string;
  category: string;
  productType: string;
  price: string;
  currency: string;
  primaryImageUrl: string;
  compatibilityCount: number;
  status: ReviewStatus;
  readiness: ListingReadiness;
}

export interface ListingDetail extends SourceListing {
  title: string;
  imageUrls: string[];
  compatibility: CompatibilityRow[];
  compatibilityCount: number;
  universalFitment: boolean;
  reviewerNote: string;
  status: ReviewStatus;
  editUpdatedAt: string;
  readiness: ListingReadiness;
}

export interface ListingStats {
  total: number;
  unreviewed: number;
  draft: number;
  approved: number;
  ready: number;
  needsTitle: number;
  needsImage: number;
  needsCompatibility: number;
}

export interface HighConfidenceFitment {
  key: string;
  brand: string;
  mpn: string;
  productDescription: string;
  identityConfidence: number;
  fitmentConfidence: number;
  oeNumbers: string[];
  fitment: CompatibilityRow[];
  evidenceBasis: string;
  sourceUrls: string[];
}