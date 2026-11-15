"use client";

import { useEffect, useRef } from "react";
import { safeSearchTerm, trackAdvertising } from "@/lib/advertising";

export function SearchAdvertisingTracker({ query }: { query: string }) {
  const tracked = useRef("");
  useEffect(() => {
    if (tracked.current === query) return;
    tracked.current = query;
    const search = safeSearchTerm(query);
    if (search)
      trackAdvertising({ name: "Search", search, id: crypto.randomUUID() });
  }, [query]);
  return null;
}
