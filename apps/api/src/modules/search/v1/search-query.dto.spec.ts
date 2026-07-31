// Decorator metadata is normally installed by the Nest bootstrap; a unit test
// loads the DTO directly, so it has to be imported here.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  SearchQueryDto,
  ALLOWED_SORTS,
  MAX_PAGE,
  MAX_QUERY_LENGTH,
} from './search-query.dto';

function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(SearchQueryDto, query, {
    enableImplicitConversion: false,
  });
  return { dto, errors: validateSync(dto, { whitelist: true }) };
}

describe('SearchQueryDto — multi-value parsing (brief §11)', () => {
  it('accepts a comma-separated list', () => {
    const { dto, errors } = parse({ brand: 'Bosch,Denso,Valeo' });
    expect(errors).toHaveLength(0);
    expect(dto.brand).toEqual(['Bosch', 'Denso', 'Valeo']);
  });

  it('accepts repeated parameters', () => {
    const { dto } = parse({ brand: ['Bosch', 'Denso'] });
    expect(dto.brand).toEqual(['Bosch', 'Denso']);
  });

  it('de-duplicates and trims', () => {
    const { dto } = parse({ brand: ' Bosch , Bosch,  Denso ' });
    expect(dto.brand).toEqual(['Bosch', 'Denso']);
  });

  it('drops empty values instead of emitting empty filters', () => {
    expect(parse({ brand: ',,,' }).dto.brand).toBeUndefined();
  });

  it('bounds parameter pollution to 25 values', () => {
    const { dto } = parse({ brand: Array.from({ length: 200 }, (_, i) => `b${i}`) });
    expect(dto.brand).toHaveLength(25);
  });

  it('truncates absurdly long filter values', () => {
    const { dto } = parse({ brand: 'x'.repeat(500) });
    expect(dto.brand![0].length).toBe(120);
  });
});

describe('SearchQueryDto — bounds and allow-lists (brief §23)', () => {
  it('rejects an oversized query', () => {
    expect(parse({ q: 'a'.repeat(MAX_QUERY_LENGTH + 1) }).errors.length).toBeGreaterThan(0);
    expect(parse({ q: 'a'.repeat(MAX_QUERY_LENGTH) }).errors).toHaveLength(0);
  });

  it('rejects a sort field that is not allow-listed', () => {
    expect(parse({ sort: 'price_asc' }).errors).toHaveLength(0);
    expect(parse({ sort: 'minPrice; DROP TABLE' }).errors.length).toBeGreaterThan(0);
    expect(parse({ sort: '_score' }).errors.length).toBeGreaterThan(0);
  });

  it('accepts every documented sort', () => {
    for (const sort of ALLOWED_SORTS) {
      expect(parse({ sort }).errors).toHaveLength(0);
    }
  });

  it('rejects deep pagination beyond the guard', () => {
    expect(parse({ page: MAX_PAGE }).errors).toHaveLength(0);
    expect(parse({ page: MAX_PAGE + 1 }).errors.length).toBeGreaterThan(0);
    expect(parse({ page: 0 }).errors.length).toBeGreaterThan(0);
    expect(parse({ page: -5 }).errors.length).toBeGreaterThan(0);
  });

  it('rejects an unbounded page size', () => {
    expect(parse({ pageSize: 24 }).errors).toHaveLength(0);
    expect(parse({ pageSize: 10000 }).errors.length).toBeGreaterThan(0);
    expect(parse({ pageSize: 25 }).errors.length).toBeGreaterThan(0);
  });

  it('bounds year and price', () => {
    expect(parse({ year: 2019 }).errors).toHaveLength(0);
    expect(parse({ year: 1800 }).errors.length).toBeGreaterThan(0);
    expect(parse({ priceMin: -1 }).errors.length).toBeGreaterThan(0);
    expect(parse({ priceMax: 99_999_999 }).errors.length).toBeGreaterThan(0);
  });
});

describe('SearchQueryDto — booleans', () => {
  it('accepts the usual truthy and falsy spellings', () => {
    expect(parse({ hasImage: 'true' }).dto.hasImage).toBe(true);
    expect(parse({ hasImage: '1' }).dto.hasImage).toBe(true);
    expect(parse({ hasImage: 'false' }).dto.hasImage).toBe(false);
    expect(parse({ hasImage: '0' }).dto.hasImage).toBe(false);
  });

  it('treats an unparseable boolean as absent rather than false', () => {
    // Defaulting to false would silently apply a filter the buyer never asked
    // for; absent leaves the dimension unfiltered.
    expect(parse({ hasImage: 'maybe' }).dto.hasImage).toBeUndefined();
    expect(parse({ hasImage: '' }).dto.hasImage).toBeUndefined();
  });
});

describe('SearchQueryDto — injection surface', () => {
  it('keeps injection attempts as inert strings', () => {
    const { dto, errors } = parse({ q: "'; DROP TABLE parts; --" });
    expect(errors).toHaveLength(0);
    expect(typeof dto.q).toBe('string');
  });

  it('never exposes a field name from user input', () => {
    // Every filter key is a fixed property; unknown params are stripped by the
    // global ValidationPipe whitelist and can never become a query field.
    const { dto } = parse({ 'script.source': 'ctx._source', evilField: 'x' } as any);
    expect((dto as any)['script.source']).toBeUndefined();
    expect((dto as any).evilField).toBeUndefined();
  });
});
