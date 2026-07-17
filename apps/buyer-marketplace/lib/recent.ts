/**
 * Device-local recall helpers: recently viewed parts and recent searches.
 * All functions are safe to call during SSR (no-ops without window).
 */

export interface RecentPart {
  id: string;
  title: string;
  image?: string | null;
  price?: number | null;
  currency?: string | null;
  viewedAt: string;
}

const VIEWED_KEY = "pb360_recently_viewed_v1";
const SEARCHES_KEY = "pb360_recent_searches_v1";
const VIEWED_MAX = 12;
const SEARCHES_MAX = 8;

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

export function getRecentlyViewed(): RecentPart[] {
  return read<RecentPart>(VIEWED_KEY);
}

export function pushRecentlyViewed(part: Omit<RecentPart, "viewedAt">) {
  if (typeof window === "undefined") return;
  const list = getRecentlyViewed().filter((p) => p.id !== part.id);
  list.unshift({ ...part, viewedAt: new Date().toISOString() });
  write(VIEWED_KEY, list.slice(0, VIEWED_MAX));
}

export function getRecentSearches(): string[] {
  return read<string>(SEARCHES_KEY);
}

export function pushRecentSearch(query: string) {
  if (typeof window === "undefined") return;
  const q = query.trim();
  if (q.length < 2) return;
  const list = getRecentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  write(SEARCHES_KEY, list.slice(0, SEARCHES_MAX));
}

export function clearRecentSearches() {
  if (typeof window === "undefined") return;
  write(SEARCHES_KEY, []);
}
