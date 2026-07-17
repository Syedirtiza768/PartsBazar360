"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon, SearchIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { PartImage } from "./PartImage";

const IMG_PROXY_BASE = process.env.NEXT_PUBLIC_IMG_PROXY_BASE || "/img-proxy/";

function fullSizeUrl(src: string): string {
  if (!src.startsWith("http")) return src;
  const upgraded = src.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, "/s-l1600.$1");
  return `${IMG_PROXY_BASE}?url=${upgraded}`;
}

/**
 * Product gallery: main stage with tap-to-zoom lightbox, thumbnail strip,
 * and keyboard navigation (arrows in the lightbox, Escape to close).
 */
export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const uniqueImages = [...new Set((images || []).filter(Boolean))];
  const hasImages = uniqueImages.length > 0;

  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  const clamped = Math.min(index, Math.max(0, uniqueImages.length - 1));
  const active = hasImages ? uniqueImages[clamped] : undefined;

  const step = useCallback(
    (dir: 1 | -1) => {
      if (uniqueImages.length < 2) return;
      setIndex((i) => (i + dir + uniqueImages.length) % uniqueImages.length);
    },
    [uniqueImages.length],
  );

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightbox, step]);

  return (
    <div>
      {/* Main stage */}
      <div className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white">
        <PartImage src={active} alt={title} className="object-contain p-4" priority />

        {hasImages && (
          <>
            <button
              type="button"
              onClick={() => setLightbox(true)}
              aria-label="Zoom image"
              className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
            />
            <span className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-graphite-950/70 px-3 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
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
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/95 p-2 text-slate-600 shadow-card transition-all hover:bg-white hover:text-slate-900 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next image"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/95 p-2 text-slate-600 shadow-card transition-all hover:bg-white hover:text-slate-900 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {uniqueImages.length > 1 && (
        <div
          className="mt-3 flex gap-2.5 overflow-x-auto pb-1 scrollbar-thin"
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
              <PartImage src={img} alt="" className="object-contain p-1" />
            </button>
          ))}
        </div>
      )}

      {!hasImages && (
        <p className="mt-3 text-sm text-slate-500">
          No product photos available for this listing — ask support for photos before ordering.
        </p>
      )}

      {/* Lightbox */}
      {lightbox && active && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-graphite-950/95 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} — enlarged image`}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-medium tabular-nums text-slate-300">
              {clamped + 1} / {uniqueImages.length}
            </p>
            <button
              type="button"
              onClick={() => setLightbox(false)}
              aria-label="Close zoom"
              className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <XIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="relative flex-1">
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
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
                >
                  <ChevronLeftIcon className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next image"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
                >
                  <ChevronRightIcon className="h-6 w-6" />
                </button>
              </>
            )}
          </div>

          {uniqueImages.length > 1 && (
            <div className="flex justify-center gap-2 overflow-x-auto px-4 py-4 scrollbar-thin">
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
                  <PartImage src={img} alt="" className="object-contain p-0.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
