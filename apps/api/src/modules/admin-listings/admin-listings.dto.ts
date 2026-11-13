import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PART_TYPES } from '@repo/catalog-contracts';

export const LISTING_STATUSES = [
  'ACTIVE',
  'PAUSED',
  'OUT_OF_STOCK',
  'REVIEW',
] as const;
export const LISTING_CONDITIONS = ['NEW', 'USED', 'REFURBISHED'] as const;
export const LISTING_CURRENCIES = ['AED', 'USD'] as const;

/** Uploaded photos are served from this API route (see ListingImagesController). */
export const LISTING_IMAGE_URL_RE =
  /^(?:\/api\/listing-images\/[0-9a-f-]{36}\.(?:jpg|png|webp)|https:\/\/\S+)$/i;

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class AdminListingQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn([...LISTING_STATUSES, 'ALL'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UpdateAdminListingDto {
  /** Buyer-facing price, in the listing's currency. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  price?: number;

  /** Fixed per-unit shipping in AED. null clears the override; 0 = free. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  shippingCost?: number | null;

  @IsOptional()
  @IsIn(LISTING_STATUSES)
  status?: string;
}

export class CreateAdminListingDto {
  @IsString()
  @IsNotEmpty()
  sellerId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/[A-Za-z0-9]/, {
    message: 'Part number must contain letters or digits',
  })
  manufacturerPartNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  oeNumbers?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsIn(LISTING_CONDITIONS)
  condition!: string;

  @IsIn(PART_TYPES)
  partType!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  price!: number;

  @IsIn(LISTING_CURRENCIES)
  currency!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  shippingCost?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(5000)
  weightKg?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sellerSku?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @Matches(LISTING_IMAGE_URL_RE, {
    each: true,
    message: 'Each image must be an uploaded photo or an https URL',
  })
  imageUrls?: string[];

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED'])
  status?: string;
}
