"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "./api";

export interface SuggestPart {
  id: string;
  title: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  minPrice: number | null;
  currency: string | null;
  manufacturerPartNumber: string | null;
}

export interface SuggestResponse {
  parts: SuggestPart[];
  categories: string[];
  brands: string[];
}

interface CacheEntry {
  data: SuggestResponse;
  ts: number;
}

const CACHE_TTL = 60_000;
const CACHE_MAX = 50;
const DEBOUNCE_MS = 200;

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): SuggestResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key: string, data: SuggestResponse) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

export function useSearchSuggestions() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SuggestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }

    const cached = cacheGet(trimmed);
    if (cached) {
      setResults(cached);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const res = await fetch(
        `${API_BASE_URL}/search/suggest?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      );
      if (!res.ok) return;
      const data: SuggestResponse = await res.json();
      cacheSet(trimmed, data);
      if (!controller.signal.aborted) {
        setResults(data);
        setLoading(false);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") setLoading(false);
    }
  }, []);

  const updateQuery = useCallback(
    (value: string) => {
      setQuery(value);
      setActiveIndex(-1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (value.trim().length < 2) {
        setResults(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      debounceRef.current = setTimeout(() => fetchSuggestions(value), DEBOUNCE_MS);
    },
    [fetchSuggestions],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const totalItems =
    (results?.parts.length ?? 0) +
    (results?.categories.length ?? 0) +
    (results?.brands.length ?? 0);

  const moveUp = useCallback(() => {
    setActiveIndex((prev) => (prev <= 0 ? totalItems - 1 : prev - 1));
  }, [totalItems]);

  const moveDown = useCallback(() => {
    setActiveIndex((prev) => (prev >= totalItems - 1 ? 0 : prev + 1));
  }, [totalItems]);

  const reset = useCallback(() => {
    setActiveIndex(-1);
  }, []);

  return {
    query,
    setQuery: updateQuery,
    results,
    loading,
    activeIndex,
    setActiveIndex,
    moveUp,
    moveDown,
    reset,
    totalItems,
  };
}
