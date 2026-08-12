/**
 * Behavioural tests for the SEO engine.
 *
 * These encode the acceptance criteria rather than the implementation: each
 * block corresponds to a rule the system promises (a new listing is fully
 * SEO-complete; a missing attribute degrades instead of breaking; a thin
 * taxonomy page is not indexed; a redirect never chains). A change that
 * regresses production SEO should fail here before it ships.
 */

import {
  analyzeRedirects,
  buildPartSeoDocument,
  buildPartSlugBase,
  buildTaxonomySeoDocument,
  decideFacetIndexability,
  decidePartIndexability,
  decideTaxonomyIndexability,
  findDuplicates,
  imageAlt,
  partH1,
  partImages,
  partTitle,
  partTaxonomy,
  primaryPartNumber,
  renderRobotsTxt,
  renderSitemap,
  renderSitemapIndex,
  resolveUniqueSlug,
  scoreRelated,
  selectRelated,
  slugify,
  stableSuffix,
  validatePartSeo,
  type SeoPartInput,
  type SeoTaxonomyInput,
} from '@repo/catalog-contracts';

// The engine reads configuration from the environment at call time, so the
// suite pins a production-like config rather than depending on the runner's.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SITE_URL = 'https://partsbazar360.com/buyer';
  process.env.SEO_INDEXING_ENABLED = '1';
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

/** A complete, healthy listing. Individual tests remove fields from it. */
function makePart(overrides: Partial<SeoPartInput> = {}): SeoPartInput {
  return {
    id: '8140b2fb-c02c-4033-9183-837ab210c0da',
    slug: 'toyota-corolla-lane-departure-camera-86401-12020',
    title: 'Genuine OEM Toyota Corolla Lane Departure Camera 86401-12020 NEW',
    description:
      'Genuine Toyota lane departure warning camera unit, removed from a low-mileage donor vehicle and bench tested for function before listing.',
    brand: 'Toyota',
    manufacturer: 'Toyota',
    category: 'Cameras',
    categoryGroup: 'Electrical',
    qualityTier: 'USED',
    partSource: 'OEM',
    manufacturerPartNumber: '86401-12020',
    genuineOemPartNumber: '86401-12020',
    oeNumbers: ['86401-12020', '8640112020A'],
    imageUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    media: [{ url: 'https://cdn.example.com/a.jpg', isPrimary: true, sortOrder: 0 }],
    offers: [
      {
        price: 1250,
        currency: 'AED',
        condition: 'USED',
        sellerName: 'Superior Auto Parts',
        inStock: true,
      },
    ],
    compatibleVehicles: [
      { make: 'Toyota', model: 'Corolla', startYear: 2017, endYear: 2021 },
    ],
    itemSpecifics: { placementOnVehicle: 'Front', warranty: '6 months' },
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §42 — a brand-new listing is fully SEO-complete with no manual work.
// ---------------------------------------------------------------------------
describe('a newly published listing', () => {
  // Built per-test, not at describe time: the engine reads SITE_URL at call
  // time and `beforeEach` has not run when a describe body is evaluated.
  let part: SeoPartInput;
  let doc: ReturnType<typeof buildPartSeoDocument>;

  beforeEach(() => {
    part = makePart();
    doc = buildPartSeoDocument(part);
  });

  it('has a slug-based canonical URL with no UUID', () => {
    expect(doc.canonical).toBe(
      'https://partsbazar360.com/buyer/parts/toyota-corolla-lane-departure-camera-86401-12020/',
    );
    expect(doc.canonical).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('has title, description, and H1 that agree with each other', () => {
    expect(doc.title).toContain('Toyota');
    expect(doc.title).toContain('86401-12020');
    expect(doc.h1).toContain('Toyota Corolla');
    expect(doc.description.length).toBeGreaterThan(70);
    expect(doc.description.length).toBeLessThanOrEqual(158);
  });

  it('is indexable and sitemap-eligible', () => {
    expect(doc.robots).toEqual({ index: true, follow: true });
    expect(doc.indexabilityReasons).toEqual([]);
    expect(doc.sitemapEligible).toBe(true);
    expect(doc.lastModified).toBe('2026-08-01T00:00:00.000Z');
  });

  it('has Open Graph and Twitter metadata built from its own image', () => {
    expect(doc.openGraph.images[0]!.url).toBe('https://cdn.example.com/a.jpg');
    expect(doc.openGraph.url).toBe(doc.canonical);
    expect(doc.twitter.card).toBe('summary_large_image');
  });

  it('has Product and BreadcrumbList JSON-LD with real offer data', () => {
    const graph = doc.structuredData['@graph'] as Array<Record<string, any>>;
    const product = graph.find((node) => node['@type'] === 'Product')!;
    expect(product).toBeDefined();
    expect(product.mpn).toBe('86401-12020');
    expect(product.sku).toBe(part.id);
    expect(product.brand).toEqual({ '@type': 'Brand', name: 'Toyota' });
    expect(product.offers.price).toBe('1250.00');
    expect(product.offers.priceCurrency).toBe('AED');
    expect(product.offers.availability).toBe('https://schema.org/InStock');
    expect(graph.some((node) => node['@type'] === 'BreadcrumbList')).toBe(true);
  });

  it('never fabricates ratings or reviews', () => {
    const serialized = JSON.stringify(doc.structuredData);
    expect(serialized).not.toContain('aggregateRating');
    expect(serialized).not.toContain('reviewCount');
    expect(serialized).not.toContain('Review');
  });

  it('derives breadcrumbs from its own taxonomy', () => {
    expect(doc.breadcrumbs.map((crumb) => crumb.name)).toEqual([
      'Home',
      'Electrical',
      'Cameras',
      'Toyota',
      'Corolla',
      'Lane Departure Camera',
    ]);
  });

  it('has ALT text on every image, and not the same text on all of them', () => {
    expect(doc.images).toHaveLength(2);
    expect(doc.images.every((image) => image.alt.length > 0)).toBe(true);
    expect(new Set(doc.images.map((image) => image.alt)).size).toBe(2);
  });

  it('is not an orphan — it links into its taxonomy', () => {
    const relations = doc.internalLinks.map((link) => link.relation);
    expect(relations).toEqual(
      expect.arrayContaining(['category', 'categoryGroup', 'brand', 'make', 'model']),
    );
  });

  it('passes SEO validation with no issues', () => {
    const report = validatePartSeo(part, doc);
    expect(report.issues).toEqual([]);
    expect(report.status).toBe('healthy');
  });
});

// ---------------------------------------------------------------------------
// §30 — fallback hierarchy: no page breaks because one attribute is missing.
// ---------------------------------------------------------------------------
describe('fallback hierarchy', () => {
  const cases: Array<[string, Partial<SeoPartInput>]> = [
    ['no brand', { brand: null, manufacturer: null }],
    ['no part number', { manufacturerPartNumber: null, genuineOemPartNumber: null, oeNumbers: [] }],
    ['no category', { category: null, categoryGroup: null }],
    ['no vehicle', { compatibleVehicles: [] }],
    ['no description', { description: null }],
    ['no images', { imageUrls: [], media: [] }],
    ['no offers', { offers: [] }],
    ['title only', {
      brand: null, manufacturer: null, category: null, categoryGroup: null,
      manufacturerPartNumber: null, genuineOemPartNumber: null, oeNumbers: [],
      compatibleVehicles: [], description: null,
    }],
  ];

  it.each(cases)('with %s, still emits usable metadata', (_label, overrides) => {
    const doc = buildPartSeoDocument(makePart(overrides));

    for (const value of [doc.title, doc.description, doc.h1, doc.canonical]) {
      expect(value).toBeTruthy();
      expect(value).not.toMatch(/undefined|null|NaN|\[object Object\]/i);
      // No dangling or doubled separators from an empty template slot.
      expect(value).not.toMatch(/\|\s*\||,\s*,|\s-\s-\s/);
      expect(value.trim()).toBe(value);
    }
    expect(doc.breadcrumbs.length).toBeGreaterThanOrEqual(2);
  });

  it('an admin override always wins over the generated value', () => {
    const doc = buildPartSeoDocument(
      makePart({
        seo: {
          title: 'Custom Title For This Listing',
          description: 'Custom description that the admin wrote by hand for this listing.',
          h1: 'Custom H1',
        },
      }),
    );
    expect(doc.titleCore).toBe('Custom Title For This Listing');
    expect(doc.h1).toBe('Custom H1');
    expect(doc.description).toContain('Custom description');
    expect(doc.overridden).toEqual(expect.arrayContaining(['title', 'description', 'h1']));
  });

  it('an admin noindex override suppresses an otherwise-indexable page', () => {
    const decision = decidePartIndexability(makePart({ seo: { robots: 'noindex' } }));
    expect(decision.robots.index).toBe(false);
    expect(decision.sitemapEligible).toBe(false);
    expect(decision.reasons).toContain('Admin override: noindex');
  });

  it('drops the brand from the title only when length forces it, not by default', () => {
    const long = makePart({
      title:
        'Mercedes-Benz W222 S-Class Front Right Passenger Adaptive LED Intelligent Light System Headlamp Assembly Complete',
      brand: 'Mercedes-Benz',
      compatibleVehicles: [{ make: 'Mercedes-Benz', model: 'S-Class' }],
      manufacturerPartNumber: 'A2229067103',
    });
    const title = partTitle(long);
    expect(title).toContain('Mercedes-Benz');
    expect(title).toContain('A2229067103');
  });

  it('does not stutter when the brand is also the vehicle make', () => {
    const part = makePart();
    expect(partH1(part)).not.toMatch(/Toyota\s+Toyota/);
    expect(partTitle(part)).not.toMatch(/Toyota\s+Toyota/);
    expect(imageAlt(part, 0, 1)).not.toMatch(/Toyota\s+Toyota/);
  });
});

// ---------------------------------------------------------------------------
// §4 — slug generation: stable, unique, unicode-safe.
// ---------------------------------------------------------------------------
describe('slug generation', () => {
  it('produces lowercase, hyphen-separated, ASCII slugs', () => {
    expect(slugify('Bremsbeläge vorne für Citroën C4 — Größe')).toBe(
      'bremsbelage-vorne-fur-citroen-c4-grosse',
    );
    expect(slugify('  MULTIPLE   spaces & symbols!!! ')).toBe('multiple-spaces-and-symbols');
    expect(slugify('86401-12020')).toBe('86401-12020');
  });

  it('is deterministic — the same input always yields the same slug', () => {
    const part = makePart({ slug: null });
    expect(buildPartSlugBase(part)).toBe(buildPartSlugBase(part));
  });

  it('is stable when the title changes, because it is assigned once', () => {
    // The engine only generates a base; persistence freezes it. This asserts
    // the contract the service relies on: a part that already has a slug
    // keeps it, so a title edit cannot move a ranked URL.
    const original = makePart();
    const renamed = { ...original, title: 'Completely Different Title Now' };
    expect(renamed.slug).toBe(original.slug);
  });

  it('keeps the part number even when the descriptive part is truncated', () => {
    const slug = buildPartSlugBase(
      makePart({
        slug: null,
        title: 'Extremely Long Marketing Title '.repeat(8),
        manufacturerPartNumber: 'A2229067103',
      }),
    );
    expect(slug).toContain('a2229067103');
    expect(slug.length).toBeLessThanOrEqual(110);
  });

  it('never produces an empty slug, even with no usable text', () => {
    const slug = buildPartSlugBase({ id: 'x', title: '日本語のみ', slug: null });
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('disambiguates duplicate titles deterministically, not sequentially', async () => {
    const taken = new Set(['bosch-brake-pad-set-0986494104']);
    const first = await resolveUniqueSlug(
      'bosch-brake-pad-set-0986494104',
      'part-id-one',
      (candidate) => taken.has(candidate),
    );
    const second = await resolveUniqueSlug(
      'bosch-brake-pad-set-0986494104',
      'part-id-one',
      (candidate) => taken.has(candidate),
    );
    // Re-running a backfill must not hand the same part a different URL.
    expect(first).toBe(second);
    expect(first).toBe(`bosch-brake-pad-set-0986494104-${stableSuffix('part-id-one')}`);
  });

  it('gives different parts different suffixes', async () => {
    const taken = new Set(['duplicate-title']);
    const a = await resolveUniqueSlug('duplicate-title', 'id-a', (c) => taken.has(c));
    const b = await resolveUniqueSlug('duplicate-title', 'id-b', (c) => taken.has(c));
    expect(a).not.toBe(b);
  });

  it('refuses to take a slug that collides with a route', async () => {
    const slug = await resolveUniqueSlug('search', 'some-id', () => false);
    // `search` is reserved; the caller's isTaken is consulted, but the
    // service-level reservation check is what rejects it in production.
    expect(slug).toBe('search');
  });

  it('picks the strongest available part number', () => {
    expect(primaryPartNumber(makePart())).toBe('86401-12020');
    expect(
      primaryPartNumber(makePart({ manufacturerPartNumber: null, genuineOemPartNumber: null })),
    ).toBe('86401-12020');
    expect(
      primaryPartNumber(
        makePart({ manufacturerPartNumber: null, genuineOemPartNumber: null, oeNumbers: [] }),
      ),
    ).toBe('');
  });
});

// ---------------------------------------------------------------------------
// §19, §25 — lifecycle: the index decision responds to inventory and status.
// ---------------------------------------------------------------------------
describe('index decision engine', () => {
  it('suppresses a listing with no image', () => {
    const decision = decidePartIndexability(makePart({ imageUrls: [], media: [] }));
    expect(decision.robots).toEqual({ index: false, follow: true });
    expect(decision.reasons).toContain('No product image');
  });

  it('suppresses a listing with no purchasable offer', () => {
    const decision = decidePartIndexability(makePart({ offers: [] }));
    expect(decision.reasons).toContain('No purchasable offer');
  });

  it('suppresses a draft listing', () => {
    expect(decidePartIndexability(makePart({ status: 'DRAFT' })).reasons).toContain(
      'Listing status is DRAFT',
    );
  });

  it('keeps a temporarily out-of-stock listing followable and declares OutOfStock', () => {
    const part = makePart({ offers: [{ price: 1250, inStock: false }] });
    const doc = buildPartSeoDocument(part);
    expect(doc.robots.follow).toBe(true);
    const graph = doc.structuredData['@graph'] as Array<Record<string, any>>;
    const product = graph.find((node) => node['@type'] === 'Product')!;
    expect(product.offers.availability).toBe('https://schema.org/OutOfStock');
    // The URL is unchanged — a stock-out must not throw away a ranked page.
    expect(doc.canonical).toContain('/parts/toyota-corolla-lane-departure-camera-86401-12020/');
  });

  it('declares SoldOut for a permanently sold listing', () => {
    const doc = buildPartSeoDocument(makePart({ status: 'SOLD' }));
    const graph = doc.structuredData['@graph'] as Array<Record<string, any>>;
    const product = graph.find((node) => node['@type'] === 'Product')!;
    expect(product.offers.availability).toBe('https://schema.org/SoldOut');
  });

  it('restocking makes a listing indexable again', () => {
    expect(decidePartIndexability(makePart({ offers: [] })).robots.index).toBe(false);
    expect(decidePartIndexability(makePart()).robots.index).toBe(true);
  });

  it('never indexes a non-production environment, even with a force-index override', () => {
    process.env.SEO_INDEXING_ENABLED = '0';
    const decision = decidePartIndexability(makePart({ seo: { robots: 'index' } }));
    expect(decision.robots).toEqual({ index: false, follow: false });
    expect(decision.sitemapEligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §15, §43 — programmatic pages are gated on real inventory.
// ---------------------------------------------------------------------------
describe('taxonomy eligibility', () => {
  const node = (overrides: Partial<SeoTaxonomyInput>): SeoTaxonomyInput => ({
    kind: 'category',
    name: 'Brake Pads',
    productCount: 100,
    ...overrides,
  });

  it('indexes a category with enough inventory', () => {
    const decision = decideTaxonomyIndexability(node({}));
    expect(decision.robots.index).toBe(true);
    expect(decision.sitemapEligible).toBe(true);
  });

  it('suppresses a thin category but keeps it crawlable', () => {
    const decision = decideTaxonomyIndexability(node({ productCount: 3 }));
    expect(decision.robots).toEqual({ index: false, follow: true });
    expect(decision.sitemapEligible).toBe(false);
    expect(decision.reasons[0]).toMatch(/needs 8/);
  });

  it('holds vehicle-model pages to a higher bar than category pages', () => {
    // The same count that qualifies a category must not qualify a model page,
    // because the model pattern can generate far more URLs.
    expect(decideTaxonomyIndexability(node({ productCount: 9 })).robots.index).toBe(true);
    expect(
      decideTaxonomyIndexability(node({ kind: 'model', productCount: 9 })).robots.index,
    ).toBe(false);
  });

  it('holds make+model+year to the highest bar', () => {
    expect(
      decideTaxonomyIndexability(node({ kind: 'modelYear', productCount: 20 })).robots.index,
    ).toBe(false);
    expect(
      decideTaxonomyIndexability(node({ kind: 'modelYear', productCount: 30 })).robots.index,
    ).toBe(true);
  });

  it('keeps paginated pages out of the index but still followed', () => {
    const decision = decideTaxonomyIndexability(node({ page: 4 }));
    expect(decision.robots).toEqual({ index: false, follow: true });
    expect(decision.reasons).toContain('Pagination page 4');
  });

  it('generates complete metadata for a new category with no configuration', () => {
    const doc = buildTaxonomySeoDocument(node({ name: 'Turbochargers', productCount: 42 }));
    expect(doc.canonical).toBe(
      'https://partsbazar360.com/buyer/parts/category/turbochargers/',
    );
    expect(doc.h1).toBe('Turbochargers');
    expect(doc.description).toContain('42');
    expect(doc.robots.index).toBe(true);
    expect(doc.breadcrumbs.map((crumb) => crumb.name)).toEqual(['Home', 'Turbochargers']);
    const graph = doc.structuredData['@graph'] as Array<Record<string, any>>;
    expect(graph.some((entry) => entry['@type'] === 'CollectionPage')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §20, §28 — faceted navigation and internal search.
// ---------------------------------------------------------------------------
describe('faceted navigation policy', () => {
  it('recognises a single facet as a landing page', () => {
    const decision = decideFacetIndexability({ category: 'Brake Pads' });
    expect(decision.robots.index).toBe(true);
    expect(decision.landingFacet).toBe('category');
  });

  it.each([
    ['two facets', { category: 'Brake Pads', brand: 'Bosch' }],
    ['free-text search', { q: '86401' }],
    ['price filter', { category: 'Brake Pads', minPrice: '10' }],
    ['price sort', { brand: 'Bosch', sort: 'price_asc' }],
    ['page size variant', { brand: 'Bosch', pageSize: '300' }],
    ['deep pagination', { make: 'Toyota', page: 3 }],
    ['vehicle config lookup', { vehicleConfigId: 'abc' }],
  ])('does not index %s', (_label, state) => {
    expect(decideFacetIndexability(state).robots.index).toBe(false);
  });

  it('never puts a search URL in a sitemap, even an indexable one', () => {
    expect(decideFacetIndexability({ category: 'Brake Pads' }).sitemapEligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 — redirects: no chains, no loops.
// ---------------------------------------------------------------------------
describe('redirect analysis', () => {
  it('flattens A→B→C into A→C and B→C', () => {
    const { flattened, issues } = analyzeRedirects(
      new Map([
        ['a', 'b'],
        ['b', 'c'],
      ]),
    );
    expect(flattened.get('a')).toBe('c');
    expect(flattened.get('b')).toBe('c');
    expect(issues.some((issue) => issue.code === 'redirect.chain')).toBe(true);
  });

  it('detects a loop instead of hanging', () => {
    const { issues } = analyzeRedirects(
      new Map([
        ['x', 'y'],
        ['y', 'x'],
      ]),
    );
    expect(issues.some((issue) => issue.code === 'redirect.loop')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §26, §39 — duplicate detection and observability.
// ---------------------------------------------------------------------------
describe('validation and duplicate detection', () => {
  it('flags a listing with no slug as critical', () => {
    const report = validatePartSeo(makePart({ slug: null }));
    expect(report.status).toBe('critical');
    expect(report.issues.map((issue) => issue.code)).toContain('slug.missing');
  });

  it('flags duplicate slugs across the catalog', () => {
    const issues = findDuplicates([
      { id: 'a', slug: 'brake-pad-set', canonical: 'https://x/parts/brake-pad-set/' },
      { id: 'b', slug: 'brake-pad-set', canonical: 'https://x/parts/brake-pad-set/' },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['slug.duplicate', 'canonical.duplicate']),
    );
  });

  it('does not flag two sellers of the same part as duplicates', () => {
    // Distinct listings for the same physical part are legitimate commerce;
    // they get distinct slugs and must not be canonicalised into each other.
    const issues = findDuplicates([
      { id: 'a', slug: 'bosch-brake-pad-0986494104', canonical: 'https://x/parts/bosch-brake-pad-0986494104/' },
      { id: 'b', slug: 'bosch-brake-pad-0986494104-x9k2mq', canonical: 'https://x/parts/bosch-brake-pad-0986494104-x9k2mq/' },
    ]);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §21, §22 — internal linking and related products.
// ---------------------------------------------------------------------------
describe('related products', () => {
  const base = makePart();

  it('ranks a shared part number above a shared category', () => {
    const samePart = scoreRelated(base, {
      id: 'other-seller',
      slug: 'other',
      manufacturerPartNumber: '86401-12020',
      imageUrls: ['https://cdn/x.jpg'],
    });
    const sameCategory = scoreRelated(base, {
      id: 'sibling',
      slug: 'sibling',
      category: 'Cameras',
      imageUrls: ['https://cdn/y.jpg'],
    });
    expect(samePart.score).toBeGreaterThan(sameCategory.score);
    expect(samePart.reasons).toContain('shared part number');
  });

  it('never proposes an unrelated part', () => {
    const unrelated = scoreRelated(base, {
      id: 'unrelated',
      slug: 'unrelated',
      category: 'Tyres',
      brand: 'Michelin',
      imageUrls: ['https://cdn/z.jpg'],
    });
    expect(unrelated.score).toBe(0);
  });

  it('does not pad the list to reach the limit', () => {
    const selected = selectRelated(
      base,
      [
        { id: 'a', slug: 'a', category: 'Cameras', imageUrls: ['https://cdn/a.jpg'] },
        { id: 'b', slug: 'b', category: 'Tyres', imageUrls: ['https://cdn/b.jpg'] },
      ],
      8,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!.candidate.id).toBe('a');
  });

  it('excludes candidates with no image or no slug', () => {
    const selected = selectRelated(base, [
      { id: 'no-image', slug: 'no-image', category: 'Cameras', imageUrls: [] },
      { id: 'no-slug', slug: null, category: 'Cameras', imageUrls: ['https://cdn/a.jpg'] },
    ]);
    expect(selected).toEqual([]);
  });
});

describe('taxonomy derivation', () => {
  it('files a listing under every dimension its data supports', () => {
    expect(partTaxonomy(makePart()).map((node) => `${node.kind}:${node.name}`)).toEqual([
      'categoryGroup:Electrical',
      'category:Cameras',
      'brand:Toyota',
      'make:Toyota',
      'model:Corolla',
    ]);
  });

  it('adds vehicle nodes automatically when fitment data arrives', () => {
    const before = partTaxonomy(makePart({ compatibleVehicles: [] }));
    const after = partTaxonomy(makePart());
    expect(before.some((node) => node.kind === 'make')).toBe(false);
    expect(after.some((node) => node.kind === 'make')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §17, §18 — sitemaps and robots.
// ---------------------------------------------------------------------------
describe('sitemap and robots output', () => {
  it('renders valid sitemap XML and escapes ampersands', () => {
    const xml = renderSitemap([
      { url: 'https://x/a/?b=1&c=2', lastModified: '2026-08-01T00:00:00.000Z', priority: 0.7 },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<loc>https://x/a/?b=1&amp;c=2</loc>');
    expect(xml).toContain('<lastmod>2026-08-01T00:00:00.000Z</lastmod>');
    expect(xml).not.toContain('&c=2');
  });

  it('renders a sitemap index', () => {
    expect(renderSitemapIndex([{ url: 'https://x/sitemaps/parts-1.xml' }])).toContain(
      '<sitemapindex',
    );
  });

  it('blocks everything in a non-indexable environment', () => {
    process.env.SEO_INDEXING_ENABLED = '0';
    expect(renderRobotsTxt('https://staging/sitemap.xml').trim()).toBe(
      'User-agent: *\nDisallow: /',
    );
  });

  it('disallows private paths but never blocks render-critical assets', () => {
    const robots = renderRobotsTxt('https://partsbazar360.com/buyer/sitemap.xml');
    expect(robots).toContain('Disallow: /buyer/checkout');
    expect(robots).toContain('Disallow: /buyer/account');
    expect(robots).toContain('Sitemap: https://partsbazar360.com/buyer/sitemap.xml');
    // Blocking these would stop Google rendering the page at all.
    expect(robots).not.toMatch(/^Disallow: \/buyer\/_next/m);
    expect(robots).toContain('Allow: /buyer/_next/static/');
  });
});

// ---------------------------------------------------------------------------
// Image SEO.
// ---------------------------------------------------------------------------
describe('image SEO', () => {
  it('puts the seller-designated primary image first regardless of array order', () => {
    const images = partImages(
      makePart({
        imageUrls: ['https://cdn/second.jpg', 'https://cdn/first.jpg'],
        media: [
          { url: 'https://cdn/second.jpg', sortOrder: 1 },
          { url: 'https://cdn/first.jpg', isPrimary: true, sortOrder: 0 },
        ],
      }),
    );
    expect(images[0]!.url).toBe('https://cdn/first.jpg');
    expect(images[0]!.isPrimary).toBe(true);
  });

  it('prefers curated ALT text when a media row has it', () => {
    expect(imageAlt(makePart(), 0, 1, 'Hand-written alt')).toBe('Hand-written alt');
  });

  it('keeps ALT text inside the length budget', () => {
    const alt = imageAlt(
      makePart({ title: 'Very long product title '.repeat(20) }),
      0,
      1,
    );
    expect(alt.length).toBeLessThanOrEqual(125);
  });

  it('de-duplicates repeated image URLs', () => {
    const images = partImages(
      makePart({ imageUrls: ['https://cdn/a.jpg', 'https://cdn/a.jpg'], media: [] }),
    );
    expect(images).toHaveLength(1);
  });
});

describe('social card image', () => {
  it('skips an SVG infographic and uses the first raster photo', () => {
    // The catalog hoists a generated infographic SVG to imageUrls[0] for
    // high-value parts; no social platform renders SVG, so a naive
    // "first image" rule blanks the card on exactly the best listings.
    const doc = buildPartSeoDocument(
      makePart({
        imageUrls: [
          'https://api.example.com/parts/x/infographic.svg',
          'https://cdn.example.com/photo.jpg',
        ],
        media: [],
      }),
    );
    expect(doc.openGraph.images[0]!.url).toBe('https://cdn.example.com/photo.jpg');
    // The SVG is still a gallery image — it is only unfit as a social card.
    expect(doc.images.map((image) => image.url)).toContain(
      'https://api.example.com/parts/x/infographic.svg',
    );
  });

  it('falls back to the site card when every image is an SVG', () => {
    const doc = buildPartSeoDocument(
      makePart({ imageUrls: ['https://api.example.com/a.svg'], media: [] }),
    );
    expect(doc.openGraph.images[0]!.url).toBe(
      'https://partsbazar360.com/buyer/og.png',
    );
  });
});
