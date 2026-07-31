/**
 * Strict request validation for the v1 search API (brief §14, §23).
 *
 * Every parameter is allow-listed and bounded. Nothing from the request ever
 * reaches a query builder as a field name, sort expression, or script — sort
 * and filter fields are fixed enums mapped to constants in the builder, so
 * search-query injection and arbitrary-sort attacks have no surface.
 */

import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ALLOWED_SORTS = [
  'relevance',
  'price_asc',
  'price_desc',
  'newest',
  'best_condition',
] as const;

export const ALLOWED_PAGE_SIZES = [24, 48, 72, 75, 150, 300] as const;

/** Longest query we will process. Guards the analyzer and the parser. */
export const MAX_QUERY_LENGTH = 200;

/** Deepest page reachable, so a crawler cannot force expensive deep offsets. */
export const MAX_PAGE = 400;

/** `a,b,c` or repeated params → string[]; bounded so parameter pollution
 *  cannot expand into a thousand-clause terms query. */
function toStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const item = String(raw ?? '').trim().slice(0, 120);
    if (item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
    if (out.length >= 25) break;
  }
  return out.length ? out : undefined;
}

function toBool(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return undefined;
}

export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUERY_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @IsOptional() @IsArray() @Transform(({ value }) => toStringArray(value))
  category?: string[];

  @IsOptional() @IsArray() @Transform(({ value }) => toStringArray(value))
  brand?: string[];

  @IsOptional() @IsArray() @Transform(({ value }) => toStringArray(value))
  make?: string[];

  @IsOptional() @IsArray() @Transform(({ value }) => toStringArray(value))
  model?: string[];

  @IsOptional() @IsArray() @Transform(({ value }) => toStringArray(value))
  partType?: string[];

  @IsOptional() @IsArray() @Transform(({ value }) => toStringArray(value))
  sourceTag?: string[];

  @IsOptional() @IsArray() @Transform(({ value }) => toStringArray(value))
  condition?: string[];

  @IsOptional() @IsArray() @Transform(({ value }) => toStringArray(value))
  seller?: string[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1950) @Max(2049)
  year?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(10_000_000)
  priceMin?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(10_000_000)
  priceMax?: number;

  @IsOptional() @IsBoolean() @Transform(({ value }) => toBool(value))
  hasImage?: boolean;

  @IsOptional() @IsBoolean() @Transform(({ value }) => toBool(value))
  inStock?: boolean;

  @IsOptional() @IsBoolean() @Transform(({ value }) => toBool(value))
  includeInterchange?: boolean;

  @IsOptional() @IsString() @MaxLength(64)
  vehicleConfigId?: string;

  @IsOptional() @IsIn(ALLOWED_SORTS)
  sort?: (typeof ALLOWED_SORTS)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(ALLOWED_PAGE_SIZES as unknown as number[])
  pageSize?: number;
}
