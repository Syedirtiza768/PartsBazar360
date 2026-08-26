import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { AppModule } from '../app.module.js';
import { CatalogProduct } from '../catalog-import/entities/catalog-product.entity.js';
import { ListingRecord } from '../listings/listing-record.entity.js';
import { StorageService } from '../storage/storage.service.js';

type ProductRow = CatalogProduct & { imageUrls: string[] };
type SourceImageBundle = {
  records?: Array<{
    targetSku?: unknown;
    sourceBrand?: unknown;
    dto?: { imageUrls?: unknown } | null;
  }>;
};

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isImageUrl(value: string): boolean {
  return /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(value);
}

function isOfficialPartsFinderImage(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.hostname.toLowerCase() === 'cdn.partsfinder.bilsteingroup.com' &&
      /\/pf-article-(?:details|zoomed)\//i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractImageUrls(html: string, pageUrl: string): string[] {
  const candidates: string[] = [];
  const attributePattern =
    /(?:data-image|data-src|data-lazy-src|src|href)\s*=\s*["']([^"']+)["']/gi;

  for (const match of html.matchAll(attributePattern)) {
    const raw = decodeHtml(match[1]);
    if (!raw || raw.startsWith('data:')) continue;
    try {
      const absolute = new URL(raw, pageUrl).toString();
      if (isHttpUrl(absolute) && isImageUrl(absolute)) candidates.push(absolute);
    } catch {
      // Ignore malformed markup and continue with the remaining images.
    }
  }

  const directUrls = html.match(/https?:\/\/[^"'<>\s]+/gi) ?? [];
  for (const raw of directUrls) {
    const value = decodeHtml(raw).replace(/[),]+$/, '');
    if (isImageUrl(value)) candidates.push(value);
  }

  const deduped = unique(candidates);
  // PartsFinder article pages contain favicons, UI icons, social pixels, and
  // related-article assets alongside the product photo.  Only the official
  // article-details/zoomed paths are product images; accepting every image
  // URL was the reason the first FEBI backfill mirrored generic UI icons.
  const official = deduped.filter(isOfficialPartsFinderImage);
  const isPartsFinderPage = /partsfinder\.bilsteingroup\.com/i.test(pageUrl);
  // Do not fall back to arbitrary page assets on an official PartsFinder
  // article. An empty result is safer: the caller preserves the current
  // gallery and reports the product for review.
  const selected = official.length ? official : isPartsFinderPage ? [] : deduped;
  return selected.sort((a, b) => {
    const score = (url: string) =>
      (url.includes('pf-article-details') ? 0 : 1) +
      (url.includes('pf-article-zoomed') ? 1 : 0) +
      (url.includes('pf-allaround') ? 2 : 0);
    return score(a) - score(b);
  });
}

async function loadSourceImageMap(
  bundlePath: string | undefined,
  brand: string,
): Promise<Map<string, string[]>> {
  if (!bundlePath) return new Map();
  const raw = await readFile(bundlePath, 'utf8');
  const bundle = JSON.parse(raw) as SourceImageBundle;
  const map = new Map<string, string[]>();
  for (const record of bundle.records ?? []) {
    const sku = typeof record.targetSku === 'string' ? record.targetSku.trim() : '';
    const sourceBrand =
      typeof record.sourceBrand === 'string' ? record.sourceBrand.trim() : '';
    const imageUrls = Array.isArray(record.dto?.imageUrls)
      ? record.dto.imageUrls.filter((value): value is string => typeof value === 'string')
      : [];
    if (
      sku &&
      sourceBrand.toUpperCase().startsWith(brand.toUpperCase()) &&
      imageUrls.length
    ) {
      map.set(sku, unique(imageUrls));
    }
  }
  return map;
}

async function fetchResolvedImageUrls(
  sourceUrl: string,
  cache: Map<string, Promise<string[]>>,
  requestDelayMs: number,
): Promise<string[]> {
  const existing = cache.get(sourceUrl);
  if (existing) return existing;

  const task = (async () => {
    if (!isHttpUrl(sourceUrl)) return [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        if (requestDelayMs > 0) await sleep(requestDelayMs);
        const response = await fetch(sourceUrl, {
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
          headers: {
            'User-Agent':
              'RealTrackApp-media-repair/1.0 (catalog image mirror; by sku)',
          },
        });
        if (response.ok) {
          const contentType =
            response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
          if (contentType.startsWith('image/')) return [sourceUrl];

          const html = await response.text();
          return extractImageUrls(html, response.url || sourceUrl);
        }

        const retryable = [429, 502, 503, 504].includes(response.status);
        if (!retryable) return [];
        await response.body?.cancel().catch(() => undefined);
        const retryAfter = Number(response.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2_000 * (attempt + 1);
        await sleep(Math.min(backoff, 20_000));
      } catch {
        if (attempt === 3) return [];
        await sleep(2_000 * (attempt + 1));
      }
    }
    return [];
  })();

  cache.set(sourceUrl, task);
  return task;
}

async function resolveProductImages(
  urls: string[],
  cache: Map<string, Promise<string[]>>,
  requestDelayMs: number,
): Promise<{ resolved: string[]; unresolved: number }> {
  const resolved: string[] = [];
  let unresolved = 0;

  for (const sourceUrl of unique(urls)) {
    if (!isHttpUrl(sourceUrl)) {
      unresolved += 1;
      continue;
    }
    const images = await fetchResolvedImageUrls(sourceUrl, cache, requestDelayMs);
    if (!images.length) unresolved += 1;
    resolved.push(...images);
  }

  return { resolved: unique(resolved), unresolved };
}

async function main(): Promise<void> {
  const brand = (argument('brand', 'FEBI') || 'FEBI').trim();
  const skuFilter = argument('sku')?.trim();
  const bundlePath = argument('bundle');
  const commit = hasFlag('commit');
  const concurrency = Math.max(
    1,
    Math.min(Number(argument('concurrency', '4')) || 4, 8),
  );
  const requestDelayArg = argument('request-delay-ms');
  const requestDelayParsed = requestDelayArg === undefined ? 250 : Number(requestDelayArg);
  const requestDelayMs = Number.isFinite(requestDelayParsed)
    ? Math.max(0, Math.min(requestDelayParsed, 5_000))
    : 250;
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const dataSource = app.get(DataSource);
    const storage = app.get(StorageService);
    const sourceImageMap = await loadSourceImageMap(bundlePath, brand);
    const productQuery = dataSource
      .getRepository(CatalogProduct)
      .createQueryBuilder('p')
      .where('p.sku LIKE :prefix', { prefix: 'PB360-%' })
      .andWhere('UPPER(COALESCE(p.brand, \'\')) LIKE :brand', {
        brand: `${brand.toUpperCase()}%`,
      })
      .andWhere('p.image_urls IS NOT NULL')
      .andWhere('array_length(p.image_urls, 1) > 0');
    if (skuFilter) {
      productQuery.andWhere('p.sku = :sku', { sku: skuFilter });
    }
    const products = (await productQuery.orderBy('p.sku', 'ASC').getMany()) as ProductRow[];

    const listingRepo = dataSource.getRepository(ListingRecord);
    const productRepo = dataSource.getRepository(CatalogProduct);
    const cache = new Map<string, Promise<string[]>>();
    const dryRun = !commit;
    let productsChanged = 0;
    let productsUnresolved = 0;
    let sourceUrls = 0;
    let resolvedUrls = 0;
    let mirroredUrls = 0;
    let listingRowsUpdated = 0;

    for (let start = 0; start < products.length; start += concurrency) {
      const batch = products.slice(start, start + concurrency);
      const results = await Promise.all(
        batch.map(async (product) => {
          // When a migration bundle is supplied, use its original article
          // URLs. The database may already contain a bad mirrored gallery from
          // an earlier run and cannot be used as the source of truth.
          const sourceUrls = bundlePath
            ? (product.sku ? sourceImageMap.get(product.sku) ?? [] : [])
            : product.imageUrls;
          const originalUrlCount = sourceUrls.length;
          const resolution = await resolveProductImages(
            sourceUrls,
            cache,
            requestDelayMs,
          );
          let changed = 0;
          let mirrored = 0;
          let listingRows = 0;

          // Never replace a gallery with a partial result. This is important
          // when the source site temporarily returns 429/5xx responses.
          if (resolution.resolved.length && resolution.unresolved === 0) {
            if (dryRun) {
              changed = 1;
            } else {
              const mirroredResults = await storage.mirrorRemoteImages(
                resolution.resolved,
                `catalog-product/${product.id}`,
                3,
              );
              const s3Urls = mirroredResults
                .filter((result) => result.s3Key && result.url)
                .map((result) => result.url);
              if (s3Urls.length) {
                mirrored = s3Urls.length;
                product.imageUrls = unique(s3Urls);
                await productRepo.save(product);
                const listingResult = await listingRepo
                  .createQueryBuilder()
                  .update(ListingRecord)
                  .set({
                    itemPhotoUrl: product.imageUrls.join('|'),
                    updatedAt: new Date(),
                  })
                  .where('customLabelSku = :sku', { sku: product.sku })
                  .andWhere('"deletedAt" IS NULL')
                  .execute();
                listingRows = listingResult.affected ?? 0;
                changed = 1;
              }
            }
          }

          return {
            sourceUrls: originalUrlCount,
            resolvedUrls: resolution.resolved.length,
            unresolved: resolution.unresolved > 0 ? 1 : 0,
            changed,
            mirrored,
            listingRows,
          };
        }),
      );

      for (const result of results) {
        sourceUrls += result.sourceUrls;
        resolvedUrls += result.resolvedUrls;
        productsUnresolved += result.unresolved;
        productsChanged += result.changed;
        mirroredUrls += result.mirrored;
        listingRowsUpdated += result.listingRows;
      }

      const processed = Math.min(start + batch.length, products.length);
      if (processed % 25 < batch.length || processed === products.length) {
        console.log(
          JSON.stringify({
            phase: dryRun ? 'resolving' : 'mirroring',
            processed,
            products: products.length,
            concurrency,
            requestDelayMs,
            productsChanged,
            productsUnresolved,
            resolvedUrls,
            mirroredUrls,
          }),
        );
      }
    }

    console.log(
      JSON.stringify({
        dryRun,
        brand,
        products: products.length,
        productsChanged,
        productsUnresolved,
        sourceUrls,
        resolvedUrls,
        mirroredUrls,
        listingRowsUpdated,
        s3Bucket: storage.getBucket(),
      }),
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
