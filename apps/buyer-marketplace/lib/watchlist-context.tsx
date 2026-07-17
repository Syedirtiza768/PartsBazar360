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

  useEffect(() => {
    setItems(readStoredItems());
    setReady(true);
  }, []);

  const persist = useCallback((next: Part[]) => {
    setItems(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
