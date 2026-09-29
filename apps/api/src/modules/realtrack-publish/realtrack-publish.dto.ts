import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  PUSH_PART_SOURCES,
  PUSH_QUALITY_TIERS,
  type PushPartSource,
  type PushQualityTier,
} from '../ingestion/realtrack-push.contract';

/** Per-request cap. Bodies are also bounded by Express' 100 kB JSON limit. */
export const MAX_PUSH_BATCH = 20;

export class PushHintsDto {
  @IsOptional()
  @IsIn([...PUSH_QUALITY_TIERS])
  qualityTier?: PushQualityTier;

  @IsOptional()
  @IsIn([...PUSH_PART_SOURCES])
  partSource?: PushPartSource;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  partType?: string;
}

export class PushListingItemDto {
  /** RealTrack's own listing id — the idempotency key for this listing. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  sourceListingId!: string;

  /**
   * Published-listing shaped payload: title, sku, price, currency,
   * quantityAvailable, listingStatus, marketplaceId, condition, brand, mpn,
   * oeNumbers, description, imageUrls, itemSpecifics, compatibility.
   * Deep-validated in the service, not here, so one bad listing does not
   * fail its whole batch.
   */
  @IsObject()
  listing!: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => PushHintsDto)
  hints?: PushHintsDto;
}

export class PushListingsDto {
  /** PartsBazar `Seller.storeId` (the RealTrack store id the seller maps to). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  storeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PUSH_BATCH)
  @ValidateNested({ each: true })
  @Type(() => PushListingItemDto)
  listings!: PushListingItemDto[];
}

export class EndListingsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  storeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  sourceListingIds!: string[];
}
