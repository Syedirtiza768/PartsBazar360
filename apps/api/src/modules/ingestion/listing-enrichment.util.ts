export interface CompatibilityRow {
  year: number | string;
  make: string;
  model: string;
  trim?: string;
  engine?: string;
  notes?: string;
  source?: string;
}

/** Upgrade eBay CDN URLs from tiny thumbnails to large gallery size. */
export function upgradeImageUrl(url: string): string {
  if (!url) return url;
  return url
    .replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1')
    .replace(/\/s-l\d+\?/i, '/s-l1600?');
}

/** Collect every image URL available on a RealTrack listing payload. */
export function extractListingImages(listing: any): string[] {
  const collected: string[] = [];

  const push = (value?: string | null) => {
    if (typeof value === 'string' && value.startsWith('http')) {
      collected.push(upgradeImageUrl(value.trim()));
    }
  };

  if (Array.isArray(listing?.imageUrls)) {
    for (const url of listing.imageUrls) push(url);
  }

  push(listing?.rawEbayResponse?.item?.imageUrl);
  push(listing?.rawEbayResponse?.item?.pictureURL);
  push(listing?.rawEbayResponse?.item?.galleryURL);

  const rawPics = listing?.rawEbayResponse?.item?.pictureURLLarge
    || listing?.rawEbayResponse?.item?.PictureURL
    || listing?.rawEbayResponse?.item?.pictureUrls;
  if (Array.isArray(rawPics)) {
    for (const url of rawPics) push(url);
  } else {
    push(rawPics);
  }

  // Deep-scan raw payload for any leftover image URLs
  try {
    const raw = JSON.stringify(listing?.rawEbayResponse || {});
    const matches = raw.match(/https?:\\?\/\\?\/[^"\\\s]+\.(?:jpg|jpeg|png|webp)/gi) || [];
    for (const match of matches) {
      push(match.replace(/\\\//g, '/'));
    }
  } catch {
    // ignore
  }

  // Preserve order, drop exact duplicates after upgrade
  return [...new Set(collected.filter(Boolean))];
}

/** Normalize RealTrack compatibility payloads into eBay-style rows. */
export function normalizeCompatibility(raw: any): CompatibilityRow[] {
  if (!raw) return [];

  const rows: CompatibilityRow[] = [];

  const pushRow = (row: Partial<CompatibilityRow>) => {
    if (!row.make && !row.model && !row.year) return;
    rows.push({
      year: row.year ?? '-',
      make: String(row.make || '-'),
      model: String(row.model || '-'),
      trim: row.trim ? String(row.trim) : '-',
      engine: row.engine ? String(row.engine) : '-',
      notes: row.notes,
      source: row.source || 'ebay',
    });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        // e.g. "2016-2024 Mini Cooper"
        const expanded = expandCompatibilityLabel(item);
        for (const row of expanded) pushRow(row);
        continue;
      }
      pushRow({
        year: item.year ?? item.Year ?? item.years ?? item.YearRange,
        make: item.make ?? item.Make ?? item.brand,
        model: item.model ?? item.Model,
        trim: item.trim ?? item.Trim ?? item.submodel ?? item.Submodel,
        engine: item.engine ?? item.Engine,
        notes: item.notes ?? item.Notes ?? item.platform,
        source: 'ebay',
      });
    }
  } else if (typeof raw === 'object') {
    const list = raw.vehicles || raw.items || raw.compatibleVehicles || raw.list;
    if (Array.isArray(list)) return normalizeCompatibility(list);
  }

  return dedupeCompatibility(rows);
}

/** Expand a year-range vehicle into one eBay-style row per model year. */
export function expandYearRangeCompatibility(input: {
  startYear?: number | null;
  endYear?: number | null;
  make: string;
  model: string;
  trim?: string;
  engine?: string;
  source?: string;
}): CompatibilityRow[] {
  const start = input.startYear || input.endYear;
  const end = input.endYear || input.startYear;
  if (!start || !end || !input.make || !input.model) return [];

  const rows: CompatibilityRow[] = [];
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  // Guard against absurd ranges
  const maxYears = Math.min(to, from + 40);

  for (let year = from; year <= maxYears; year++) {
    rows.push({
      year,
      make: input.make,
      model: input.model,
      trim: input.trim || '-',
      engine: input.engine || '-',
      source: input.source || 'title',
    });
  }

  return rows;
}

function expandCompatibilityLabel(label: string): CompatibilityRow[] {
  const match = label.match(/(20\d{2})\s*[-–]\s*(20\d{2})\s+(.+)/)
    || label.match(/(20\d{2})\s+(.+)/);
  if (!match) return [];

  if (match.length === 4) {
    const [, start, end, rest] = match;
    const parts = rest.trim().split(/\s+/);
    const make = parts[0];
    const model = parts.slice(1).join(' ') || '-';
    return expandYearRangeCompatibility({
      startYear: parseInt(start, 10),
      endYear: parseInt(end, 10),
      make,
      model,
      source: 'label',
    });
  }

  const [, year, rest] = match;
  const parts = rest.trim().split(/\s+/);
  return [{
    year: parseInt(year, 10),
    make: parts[0] || '-',
    model: parts.slice(1).join(' ') || '-',
    trim: '-',
    engine: '-',
    source: 'label',
  }];
}

function dedupeCompatibility(rows: CompatibilityRow[]): CompatibilityRow[] {
  const seen = new Set<string>();
  const out: CompatibilityRow[] = [];
  for (const row of rows) {
    const key = `${row.year}|${row.make}|${row.model}|${row.trim}|${row.engine}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => Number(a.year) - Number(b.year));
}

/** Merge compatibility from RealTrack + title-inferred vehicle. */
export function buildCompatibility(listing: any, parsedVehicle?: {
  startYear: number;
  endYear: number;
  make: string;
  model: string;
} | null): CompatibilityRow[] {
  const fromListing = normalizeCompatibility(listing?.compatibility);
  if (fromListing.length > 0) return fromListing;

  // itemSpecifics sometimes carries fitment-ish values
  const specifics = listing?.itemSpecifics || {};
  if (specifics && typeof specifics === 'object') {
    const make = specifics.Make || specifics.make;
    const model = specifics.Model || specifics.model;
    const year = specifics.Year || specifics.year;
    if (make && model && year) {
      const yearStr = String(year);
      const range = yearStr.match(/(20\d{2})\s*[-–]\s*(20\d{2})/);
      if (range) {
        return expandYearRangeCompatibility({
          startYear: parseInt(range[1], 10),
          endYear: parseInt(range[2], 10),
          make: String(make),
          model: String(model),
          trim: specifics.Trim || specifics.Submodel,
          engine: specifics.Engine,
          source: 'item_specifics',
        });
      }
      return [{
        year: yearStr,
        make: String(make),
        model: String(model),
        trim: String(specifics.Trim || specifics.Submodel || '-'),
        engine: String(specifics.Engine || '-'),
        source: 'item_specifics',
      }];
    }
  }

  if (parsedVehicle) {
    return expandYearRangeCompatibility({
      startYear: parsedVehicle.startYear,
      endYear: parsedVehicle.endYear,
      make: parsedVehicle.make,
      model: parsedVehicle.model,
      source: 'title',
    });
  }

  return [];
}
