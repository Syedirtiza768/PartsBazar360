import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CURRENCY = /^[A-Za-z]{3}$/;
const booleanTransform = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === true || value === 'true';

export class RealtrackBridgeOfferQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  sourceTag?: string;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit = 100;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  @Type(() => Number)
  page = 1;

  @IsOptional()
  @Matches(CURRENCY)
  sourceCurrency?: string;

  @IsOptional()
  @Matches(CURRENCY)
  targetCurrency?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(booleanTransform)
  includeOutOfStock?: boolean;
}

export class RealtrackBridgeSelectionDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  offerIds?: string[];

  /** Resolve the current filters server-side instead of relying on visible rows. */
  @IsOptional()
  @IsBoolean()
  @Transform(booleanTransform)
  selectAll?: boolean;

  /** Safety cap for a filtered transfer. The supported maximum is 5,000. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  @Type(() => Number)
  maxItems = 5000;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  sourceTag?: string;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Matches(CURRENCY)
  sourceCurrency?: string;

  @IsOptional()
  @Matches(CURRENCY)
  targetCurrency?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(booleanTransform)
  includeOutOfStock?: boolean;

  /** Defaults to true so a preview cannot create remote records by accident. */
  @IsOptional()
  @IsBoolean()
  @Transform(booleanTransform)
  dryRun?: boolean;

  /** Optional second step through RealTrack's existing eBay publisher. */
  @IsOptional()
  @IsBoolean()
  @Transform(booleanTransform)
  publishToEbay?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  storeIds?: string[];

  @IsOptional()
  @IsString()
  shippingProfileName?: string;

  @IsOptional()
  @IsString()
  returnProfileName?: string;

  @IsOptional()
  @IsString()
  paymentProfileName?: string;
}
