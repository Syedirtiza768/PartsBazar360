import type { MetadataRoute } from 'next';
import { INTERNAL_API_URL } from '@/lib/api';
import { absoluteUrl, searchCanonical } from '@/lib/seo';

// Runtime-only — avoid blocking Docker/CI builds when the API is unreachable.
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

async function getPartUrls(): Promise<{ id: string; updatedAt?: string }[]> {
  const urls: { id: string; updatedAt?: string }[] = [];
  const pageSize = 200;
  // OpenSearch browse currently surfaces up to ~10k; keep sitemap generation
  // bounded but large enough for the live catalog.
  const maxPages = 50;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await fetch(
        `${INTERNAL_API_URL}/search/parts?sort=newest&page=${page}&limit=${pageSize}`,
        {
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) break;
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) break;
      urls.push(
        ...items.map((p: { id: string; createdAt?: string }) => ({
          id: p.id,
          updatedAt: p.createdAt,
        })),
      );
      if (items.length < pageSize) break;
    } catch {
      break;
    }
  }

  return urls;
}

async function getFacets(): Promise<{
  brands: Array<{ name: string; count: number }>;
  categories: Array<{ name: string; count: number }>;
  makes: Array<{ name: string; count: number }>;
}> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/facets`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { brands: [], categories: [], makes: [] };
    return res.json();
  } catch {
    return { brands: [], categories: [], makes: [] };
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/search'), changeFrequency: 'hourly', priority: 0.9 },
  ];

  const [parts, facets] = await Promise.all([getPartUrls(), getFacets()]);

  // Indexable category / brand hubs (single-facet only — no filter combinations).
  const categoryRoutes: MetadataRoute.Sitemap = (facets.categories || [])
    .filter((c) => c.name && c.count > 0)
    .map((c) => ({
      url: searchCanonical({ category: c.name }),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    }));

  const brandRoutes: MetadataRoute.Sitemap = (facets.brands || [])
    .filter((b) => b.name && b.count > 0)
    .map((b) => ({
      url: searchCanonical({ brand: b.name }),
      changeFrequency: 'daily' as const,
      priority: 0.75,
    }));

  const partRoutes: MetadataRoute.Sitemap = parts.map((p) => ({
    url: absoluteUrl(`/part/${p.id}`),
    lastModified: p.updatedAt,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...categoryRoutes, ...brandRoutes, ...partRoutes];
}
