import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/seo';

// Must be dynamic: a static build-time evaluation previously baked the
// localhost fallback into production robots.txt while SITE_URL was only
// available at container runtime.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/cart',
          '/checkout',
          '/account',
          '/login',
          '/signup',
          '/watchlist',
          '/garage',
          '/api/',
        ],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
