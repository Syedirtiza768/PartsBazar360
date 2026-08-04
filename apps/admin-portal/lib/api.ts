// In production (Docker), nginx proxies `/api/*` to the API service, so a
// relative path works regardless of which admin page is open.
// For local `next dev` without nginx, set NEXT_PUBLIC_API_URL=http://localhost:3001
// in a `.env.local` file to talk to the API directly.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

/** fetch() that attaches the admin's bearer token — every admin-gated API route requires it. */
export async function apiFetch(
  token: string | null,
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
