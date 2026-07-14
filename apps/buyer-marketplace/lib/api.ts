// In production (Docker), nginx proxies `/api/*` to the API service, so a
// relative path works from the browser regardless of which portal is open.
// For local `next dev` without nginx, set NEXT_PUBLIC_API_URL=http://localhost:3001
// in a `.env.local` file to talk to the API directly.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

// Server Components/route handlers (sitemap, generateMetadata, SSR data
// fetching) run inside the Next.js container itself, where a relative "/api"
// URL isn't a valid fetch target — they talk to the API service directly
// over the internal Docker network instead.
export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:7070/buyer';
