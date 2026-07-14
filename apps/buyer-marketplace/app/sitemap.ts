import type { MetadataRoute } from 'next';
import { INTERNAL_API_URL, SITE_URL } from '@/lib/api';

export const revalidate = 3600;

async function getPartUrls(): Promise<{ id: string; updatedAt?: string }[]> {
  const urls: { id: string; updatedAt?: string }[] = [];
  const pageSize = 200;
  const maxPages = 10; // caps the sitemap at ~2,000 product URLs per generation

  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await fetch(`${INTERNAL_API_URL}/search/parts?sort=newest&page=${page}&limit=${pageSize}`, {
        next: { revalidate: 3600 },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) break;
      urls.push(...items.map((p: any) => ({ id: p.id, updatedAt: p.createdAt })));
      if (items.length < pageSize) break;
    } catch {
      break;
    }
  }

  return urls;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/search`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/garage`, changeFrequency: 'weekly', priority: 0.3 },
  ];

  const parts = await getPartUrls();
  const partRoutes: MetadataRoute.Sitemap = parts.map((p) => ({
    url: `${SITE_URL}/part/${p.id}`,
    lastModified: p.updatedAt,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [...staticRoutes, ...partRoutes];
}
