import { Injectable, Logger } from '@nestjs/common';

export type FebestCompatibilityRow = {
  year: number | string;
  make: string;
  model: string;
  trim: string;
  engine: string;
  source: 'febest.de';
  market?: string | null;
  raw?: string;
};

export type FebestLiveEnrichment = {
  code: string;
  detailsUrl: string;
  imageUrls: string[];
  oemNumbers: string[];
  models: string[];
  compatibility: FebestCompatibilityRow[];
  source: 'febest.de';
  fetchedAt: string;
};

const BASE = 'https://febest.de';
const USER_AGENT =
  'PartsBazar360/1.0 (+https://partsbazar360.realtrackapp.com; live catalog lookup)';

@Injectable()
export class FebestWebsiteService {
  private readonly logger = new Logger(FebestWebsiteService.name);
  /** In-memory only — not Postgres. Speeds up search cards across requests. */
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: FebestLiveEnrichment | null }
  >();
  private readonly cacheTtlMs = Number(process.env.FEBEST_LIVE_CACHE_TTL_MS || 30 * 60 * 1000);
  private readonly searchConcurrency = Math.max(
    1,
    Number(process.env.FEBEST_SEARCH_CONCURRENCY || 6),
  );

  /** True when this catalog part should resolve media/fitment from febest.de live. */
  isFebestPart(part: {
    brand?: string | null;
    primaryBrand?: {
      name?: string | null;
      displayName?: string | null;
      canonicalName?: string | null;
    } | null;
    manufacturerPartNumber?: string | null;
    offers?: Array<{ sellerId?: string | null; seller?: { name?: string | null } | null }>;
  }): boolean {
    const brand = (
      part.brand ||
      part.primaryBrand?.name ||
      part.primaryBrand?.displayName ||
      part.primaryBrand?.canonicalName ||
      ''
    )
      .trim()
      .toUpperCase();
    if (brand === 'FEBEST') return Boolean(part.manufacturerPartNumber);
    if (
      (part.offers || []).some(
        (o) =>
          o.sellerId === 'seed-febest-inventory-supplier' ||
          /febest/i.test(o.seller?.name || ''),
      )
    ) {
      return Boolean(part.manufacturerPartNumber);
    }
    return false;
  }

  hasFebestImage(part: { imageUrls?: string[] | null }): boolean {
    return (part.imageUrls || []).some((u) => String(u).includes('static.febest.de'));
  }

  /**
   * Attach live febest.de image URLs onto search/browse card payloads.
   * Does not persist; uses a short in-memory cache so page flips stay fast.
   * Skips compatibility expansion (PDP fetches that live separately).
   */
  async attachImagesToSearchItems<T extends Record<string, any>>(items: T[]): Promise<T[]> {
    if (!items?.length) return items;

    const targets = items.filter(
      (item) =>
        this.isFebestPart(item) &&
        item.manufacturerPartNumber &&
        // Skip live HTTP when the card already has any image — enrichment
        // scripts persist febest.de URLs; cold live fetch is for empty cards only.
        !(item.imageUrls && item.imageUrls.length > 0) &&
        !this.hasFebestImage(item),
    );
    if (targets.length === 0) return items;

    const byMpn = new Map<string, Array<Record<string, any>>>();
    for (const item of targets) {
      const mpn = String(item.manufacturerPartNumber).trim().toUpperCase();
      const list = byMpn.get(mpn) || [];
      list.push(item);
      byMpn.set(mpn, list);
    }

    const mpns = [...byMpn.keys()];
    await this.mapPool(mpns, this.searchConcurrency, async (mpn) => {
      const live = await this.fetchLiveByMpn(mpn, { includeCompatibility: false });
      if (!live?.imageUrls?.length) return;
      for (const item of byMpn.get(mpn) || []) {
        item.imageUrls = live.imageUrls;
        item.listingUrl = live.detailsUrl;
        item.enrichmentSource = 'febest.de';
      }
    });

    return items;
  }

  /**
   * Live lookup only — never persists to Postgres. Fetches catalog + details
   * from febest.de for the given MPN and returns hotlinked images (+ optional compatibility).
   */
  async fetchLiveByMpn(
    mpn: string,
    options?: { includeCompatibility?: boolean },
  ): Promise<FebestLiveEnrichment | null> {
    const code = String(mpn || '').trim();
    if (!code) return null;

    const includeCompatibility = options?.includeCompatibility !== false;
    const cacheKey = `${code.toUpperCase()}:${includeCompatibility ? 'full' : 'images'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const catalogUrl = `${BASE}/en/catalog?code=${encodeURIComponent(code)}`;
      const catalogHtml = await this.fetchText(catalogUrl);
      if (!catalogHtml) {
        this.cache.set(cacheKey, { expiresAt: Date.now() + 60_000, value: null });
        return null;
      }

      const detailsPath = this.findDetailsPath(catalogHtml, code);
      if (!detailsPath) {
        this.logger.warn(`FEBEST details not found for ${code}`);
        this.cache.set(cacheKey, { expiresAt: Date.now() + 60_000, value: null });
        return null;
      }

      const detailsUrl = `${BASE}${detailsPath}`;
      const detailsHtml = await this.fetchText(detailsUrl);
      if (!detailsHtml) {
        this.cache.set(cacheKey, { expiresAt: Date.now() + 60_000, value: null });
        return null;
      }

      const imageUrls = this.parseImages(detailsHtml);
      const oemNumbers = includeCompatibility ? this.parseOemOptions(detailsHtml) : [];
      const models = includeCompatibility ? this.parseModelOptions(detailsHtml) : [];
      const compatibility = includeCompatibility
        ? this.buildCompatibilityRows(models)
        : [];

      const value: FebestLiveEnrichment = {
        code,
        detailsUrl,
        imageUrls,
        oemNumbers,
        models,
        compatibility,
        source: 'febest.de',
        fetchedAt: new Date().toISOString(),
      };
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + this.cacheTtlMs,
        value,
      });
      return value;
    } catch (err: any) {
      this.logger.warn(`FEBEST live fetch failed for ${code}: ${err?.message || err}`);
      return null;
    }
  }

  private async mapPool<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        await worker(items[idx]);
      }
    });
    await Promise.all(runners);
  }

  private async fetchText(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private findDetailsPath(html: string, code: string): string | null {
    const codeSlug = code.toLowerCase().replace(/-/g, '_');
    const exact = new RegExp(
      `href="(/en/details/[^"]*-${this.escapeRegExp(codeSlug)})"`,
      'i',
    );
    const m = html.match(exact);
    if (m?.[1]) return m[1];

    const all = [...html.matchAll(/href="(\/en\/details\/[^"]+)"/gi)].map((x) => x[1]);
    return all.find((href) => href.toLowerCase().endsWith(`-${codeSlug}`)) || null;
  }

  private parseOemOptions(html: string): string[] {
    const block = html.match(/id="oem_select"[^>]*>([\s\S]*?)<\/select>/i);
    if (!block) return [];
    return [
      ...new Set(
        [...block[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>/gi)]
          .map((m) => m[1].trim())
          .filter((v) => v && v !== '0'),
      ),
    ];
  }

  private parseModelOptions(html: string): string[] {
    const block = html.match(/id="model_list"[^>]*>([\s\S]*?)<\/select>/i);
    if (!block) return [];
    return [
      ...new Set(
        [...block[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>/gi)]
          .map((m) => m[1].trim())
          .filter(Boolean),
      ),
    ];
  }

  private parseImages(html: string): string[] {
    const urls = [...html.matchAll(/https:\/\/static\.febest\.de\/images\/[^"'>\s]+/gi)].map(
      (m) => m[0].replace(/&amp;/g, '&'),
    );
    const unique = [...new Set(urls)];
    const big = unique.filter((u) => /\/images\/big\//i.test(u));
    const photos = unique.filter(
      (u) => !/\/images\/big\//i.test(u) && /_p\d+\.(jpg|jpeg|png|webp)$/i.test(u),
    );
    const rest = unique.filter(
      (u) =>
        !big.includes(u) &&
        !photos.includes(u) &&
        !/_s\d+\.(png|jpg|jpeg|webp)$/i.test(u),
    );
    return [...big, ...photos, ...rest].slice(0, 12);
  }

  private parseModelLine(raw: string) {
    // FORD RANGER ES 2009-2012 [EU]
    // TOYOTA RAV4 ACA2# 2000.08-2005.11 [EU]
    // FORD EVEREST EP 2009- [EU]
    const m = String(raw).match(
      /^(\S+)\s+(.+?)\s+(\d{4})(?:\.(\d{2}))?\s*-\s*(?:(\d{4})(?:\.(\d{2}))?)?\s*\[([^\]]+)\]\s*$/,
    );
    if (!m) {
      return {
        make: null as string | null,
        model: raw,
        startYear: null as number | null,
        endYear: null as number | null,
        market: null as string | null,
        raw,
      };
    }
    const startYear = Number(m[3]);
    const endYear = m[5] ? Number(m[5]) : new Date().getFullYear();
    return {
      make: m[1],
      model: m[2].trim(),
      startYear,
      endYear: Math.max(endYear, startYear),
      market: m[7],
      raw,
    };
  }

  private buildCompatibilityRows(models: string[]): FebestCompatibilityRow[] {
    const rows: FebestCompatibilityRow[] = [];
    const currentYear = new Date().getFullYear();
    for (const raw of models) {
      const parsed = this.parseModelLine(raw);
      if (!parsed.make || !parsed.startYear) {
        rows.push({
          year: '-',
          make: parsed.make || '-',
          model: parsed.model || raw,
          trim: '-',
          engine: '-',
          source: 'febest.de',
          market: parsed.market,
          raw,
        });
        continue;
      }
      const from = parsed.startYear;
      const to = Math.min(parsed.endYear || currentYear, from + 40);
      for (let year = from; year <= to; year++) {
        rows.push({
          year,
          make: parsed.make,
          model: parsed.model,
          trim: '-',
          engine: '-',
          source: 'febest.de',
          market: parsed.market,
          raw,
        });
      }
    }
    return rows;
  }
}
