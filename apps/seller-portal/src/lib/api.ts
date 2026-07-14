// In production (Docker), nginx proxies `/api/*` to the API service, so a
// relative path works from the browser regardless of which portal is open.
// For local `next dev` without nginx, set NEXT_PUBLIC_API_URL=http://localhost:3001
// in a `.env.local` file to talk to the API directly.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';
