"use client";

import { useState } from "react";
import { CameraIcon } from "@repo/ui/icons";

interface PartImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  /** Prefer full-size CDN variants for LCP/hero images only. */
  priority?: boolean;
  fill?: boolean;
  /**
   * Explicit eBay-style size token. Defaults to thumbnail for cards and
   * full-size when `priority` is set (gallery hero).
   */
  imageSize?: 300 | 500 | 1600;
}

// Same-origin nginx proxy in production; override for local dev so images
// load without the docker stack (nginx requires the url param unencoded,
// so we can't route this through a Next.js rewrite).
const IMG_PROXY_BASE = process.env.NEXT_PUBLIC_IMG_PROXY_BASE || "/img-proxy/";

function resolveEbaySize(
  priority: boolean,
  imageSize: PartImageProps["imageSize"],
  sizes?: string,
): 300 | 500 | 1600 {
  if (imageSize) return imageSize;
  if (priority) return 1600;
  // Card grids pass a multi-column sizes hint — keep payloads small.
  if (sizes && /25vw|33vw|50vw/.test(sizes)) return 300;
  return 500;
}

function proxyUrl(
  src: string,
  size: 300 | 500 | 1600,
): string {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    const url = src.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, `/s-l${size}.$1`);
    return `${IMG_PROXY_BASE}?url=${url}`;
  }
  return src;
}

/**
 * Real listing photos come from many third-party seller CDNs, so we can't
 * guarantee every URL stays reachable. Routes external images through the
 * nginx proxy to bypass hotlinking restrictions. Falls back to a placeholder.
 *
 * Card/thumbnail callers should pass `sizes` (or `imageSize={300}`) so we do
 * not pull full `s-l1600` assets into grid layouts.
 */
export function PartImage({
  src,
  alt,
  className,
  sizes,
  priority = false,
  fill = true,
  imageSize,
}: PartImageProps) {
  const [errored, setErrored] = useState(false);
  const size = resolveEbaySize(priority, imageSize, sizes);

  if (!src || errored) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 bg-slate-100 text-slate-300 ${fill ? "absolute inset-0 h-full w-full" : ""} ${className ?? ""}`}
        role="img"
        aria-label={`No photo available for ${alt}`}
      >
        <CameraIcon className="h-10 w-10" />
        <span className="text-[11px] font-medium text-graphite-600">No photo</span>
      </div>
    );
  }

  const proxied = proxyUrl(src, size);

  return (
    // The marketplace proxy handles heterogeneous seller-CDN images and fallbacks.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={proxied}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      referrerPolicy="no-referrer"
      className={
        fill
          ? `absolute inset-0 h-full w-full object-contain ${className ?? ""}`
          : className
      }
      onError={() => setErrored(true)}
    />
  );
}
