"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Part } from "./types";
import { fetchLivePart } from "./live-part";

const STORAGE_KEY = "pb360_watchlist_v1";

type WatchlistContextValue = {
  items: Part[];
  ready: boolean;
  count: number;
  isWatched: (partId: string) => boolean;
  toggle: (part: Part) => boolean;
  remove: (partId: string) => void;
};

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

function readStoredItems(): Part[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Part[]>([]);
  const [ready, setReady] = useState(false);

  const persist = useCallback((next: Part[]) => {
    setItems(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  // Re-validate device-local snapshots against the live API so deleted /
  // no-offer parts never linger on the watchlist page or badge count.
  useEffect(() => {
    let cancelled = false;
    const stored = readStoredItems();

    if (stored.length === 0) {
      setItems([]);
      setReady(true);
      return;
    }

    (async () => {
      const lives = await Promise.all(stored.map((part) => fetchLivePart(part.id)));
      if (cancelled) return;
      const next = lives.filter((part): part is Part => part != null);
      setItems(next);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isWatched = useCallback(
    (partId: string) => items.some((item) => item.id === partId),
    [items],
  );

  const toggle = useCallback(
    (part: Part) => {
      const exists = items.some((item) => item.id === part.id);
      persist(exists ? items.filter((item) => item.id !== part.id) : [part, ...items]);
      return !exists;
    },
    [items, persist],
  );

  const remove = useCallback(
    (partId: string) => persist(items.filter((item) => item.id !== partId)),
    [items, persist],
  );

  const value = useMemo(
    () => ({ items, ready, count: items.length, isWatched, toggle, remove }),
    [items, ready, isWatched, toggle, remove],
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist() {
  const value = useContext(WatchlistContext);
  if (!value) throw new Error("useWatchlist must be used within WatchlistProvider");
  return value;
}
