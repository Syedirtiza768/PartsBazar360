import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DROPPABLE = [
  'number',
  'make',
  'model',
  'year',
  'side',
  'position',
] as const;
export type Droppable = (typeof DROPPABLE)[number];

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

function toList(value: unknown): string[] | undefined {
  if (value == null || value === '') return undefined;
  const list = (Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)].slice(0, 10) : undefined;
}

function toBool(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return undefined;
}

/** Staff "every sellable option" search. All params bounded and allow-listed. */
export class OptionsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  /** Exact vehicle configuration (picker). */
  @IsOptional()
  @IsString()
  @Matches(ID_RE)
  vehicleConfigId?: string;

  @IsOptional()
  @IsString()
  @Matches(ID_RE)
  makeId?: string;

  @IsOptional()
  @IsString()
  @Matches(ID_RE)
  modelId?: string;

  /** Make / model names (VIN decode, free text). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2049)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(10)
  engineLitres?: number;

  /** Interpretation chips the user removed. */
  @IsOptional()
  @IsArray()
  @IsIn(DROPPABLE as unknown as string[], { each: true })
  @Transform(({ value }) => toList(value))
  drop?: Droppable[];

  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  includeUnavailable?: boolean;

  /** Text queries page through relevance-ranked candidates. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([24, 48, 72])
  pageSize?: number;
}
