"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon, SearchIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { useBodyScrollLock } from "@repo/ui/use-body-scroll-lock";
import { useFocusTrap } from "@repo/ui/use-focus-trap";
import { PartImage } from "./PartImage";

const IMG_PROXY_BASE = process.env.NEXT_PUBLIC_IMG_PROXY_BASE || "/img-proxy/";

function fullSizeUrl(src: string): string {
  if (!src.startsWith("http")) return src;
  const upgraded = src.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, "/s-l1600.$1");
  return `${IMG_PROXY_BASE}?url=${upgraded}`;
}

/**
 * Normalize an image URL for deduplication: strip query params, upgrade
 * eBay size tokens to a canonical size, and lower-case.
 */
function normalizeForDedup(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname
      .replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1')
      .replace(/\/\$_\d+\.(jpg|jpeg|png|webp)$/i, '/$_57.$1');
    return `${parsed.origin}${pathname}`.toLowerCase();
  } catch {
    return url
      .replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1')
      .replace(/\/\$_\d+\.(jpg|jpeg|png|webp)$/i, '/$_57.$1')
      .replace(/\?.*$/, '')
      .toLowerCase();
  }
}

function isSvgUrl(url: string): boolean {
  return /\.svg(?:\?.*)?$/i.test(url);
}

/**
 * Product gallery: main stage with tap-to-zoom lightbox, thumbnail strip,
 * and keyboard navigation (arrows in the lightbox, Escape to close).
 */
export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  // Deduplicate by normalized URL ignoring eBay size variants and query-param
  // tracking duplicates (e.g. `?set_id=8800005007`). Also drop SVGs — seller
  // listing images should never be SVGs.
  const seen = new Set<string>();
  const allImages = (images || []).filter(Boolean);
  const uniqueImages: string[] = [];
  for (const img of allImages) {
    if (isSvgUrl(img)) continue;
    const norm = normalizeForDedup(img);
    if (!seen.has(norm)) {
      seen.add(norm);
      uniqueImages.push(img);
    }
  }
  const hasImages = uniqueImages.length > 0;

  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const lightboxRef = useRef<HTMLDivElement>(null);

  const clamped = Math.min(index, Math.max(0, uniqueImages.length - 1));
  const active = hasImages ? uniqueImages[clamped] : undefined;

  const step = useCallback(
    (dir: 1 | -1) => {
      if (uniqueImages.length < 2) return;
      setIndex((i) => (i + dir + uniqueImages.length) % uniqueImages.length);
    },
    [uniqueImages.length],
  );

  // Shared hooks rather than a local `body.style.overflow = "hidden"`, which
  // iOS Safari ignores for the document scroller: the page kept scrolling
  // behind the zoom and restored to the wrong offset on close.
  useBodyScrollLock(lightbox);
  useFocusTrap(lightboxRef, lightbox);

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, step]);

  return (
    <div>
      {/* Main stage */}
      <div className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white">
        <PartImage src={active} alt={title} className="object-contain p-4" priority imageSize={1600} />

        {hasImages && (
          <>
            <button
              type="button"
              onClick={() => setLightbox(true)}
              aria-label="Zoom image"
              className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
            />
            <span className="pointer-events-none absolute bottom-3 left-3 hidden items-center gap-1.5 rounded-full bg-graphite-950/70 px-3 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 [@media(hover:hover)]:inline-flex">
              <SearchIcon className="h-3.5 w-3.5" /> Click to zoom
            </span>
            <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-graphite-950/70 px-2.5 py-1 text-xs font-medium tabular-nums text-white">
              {clamped + 1} / {uniqueImages.length}
            </span>
          </>
        )}

        {uniqueImages.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous image"
              className="absolute left-2 top-1/2 flex touch-target -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-graphite-700 shadow-card transition-all hover:bg-white hover:text-slate-900 sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next image"
              className="absolute right-2 top-1/2 flex touch-target -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-graphite-700 shadow-card transition-all hover:bg-white hover:text-slate-900 sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {uniqueImages.length > 1 && (
        <div
          className="scroll-rail mt-3 gap-2.5 pb-1"
          role="group"
          aria-label="Image thumbnails"
        >
          {uniqueImages.slice(0, 16).map((img, i) => (
            <button
              key={img + i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`View image ${i + 1} of ${uniqueImages.length}`}
              aria-current={i === clamped}
              className={cn(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                i === clamped
                  ? "border-brand-600"
                  : "border-slate-200 opacity-80 hover:border-slate-300 hover:opacity-100",
              )}
            >
              <PartImage src={img} alt="" className="object-contain p-1" imageSize={300} />
            </button>
          ))}
        </div>
      )}

      {!hasImages && (
        <p className="mt-3 text-sm text-graphite-600">
          No product photos available for this listing — ask support for photos before ordering.
        </p>
      )}

      {/* Lightbox */}
      {lightbox && active && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-modal flex h-dvh flex-col bg-graphite-950/95 animate-fade-in"
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          aria-label={`${title} — enlarged image`}
        >
          {/* pt-safe keeps the close control clear of the status bar / notch
              when the zoom goes edge to edge. */}
          <div className="flex shrink-0 items-center justify-between gutter py-3 pt-safe">
            <p className="text-sm font-medium tabular-nums text-slate-300">
              {clamped + 1} / {uniqueImages.length}
            </p>
            <button
              type="button"
              onClick={() => setLightbox(false)}
              aria-label="Close zoom"
              className="flex touch-target items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <XIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="relative min-h-0 flex-1">
            {/* The proxy requests the original high-resolution asset for the zoom surface. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fullSizeUrl(active)}
              alt={title}
              className="absolute inset-0 h-full w-full object-contain p-4 sm:p-10"
            />
            {uniqueImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous image"
                  className="absolute left-3 top-1/2 flex touch-target -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                >
                  <ChevronLeftIcon className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next image"
                  className="absolute right-3 top-1/2 flex touch-target -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                >
                  <ChevronRightIcon className="h-6 w-6" />
                </button>
              </>
            )}
          </div>

          {uniqueImages.length > 1 && (
            <div className="scroll-rail shrink-0 justify-start gap-2 gutter py-4 pb-safe-b-4 sm:justify-center">
              {uniqueImages.slice(0, 16).map((img, i) => (
                <button
                  key={`lb-${img}-${i}`}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`View image ${i + 1}`}
                  className={cn(
                    "relative h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 bg-white transition-colors",
                    i === clamped ? "border-brand-400" : "border-transparent opacity-60 hover:opacity-100",
                  )}
                >
                  <PartImage src={img} alt="" className="object-contain p-0.5" imageSize={300} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
