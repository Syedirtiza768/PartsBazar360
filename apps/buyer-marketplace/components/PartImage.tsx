"use client";

import { useState } from "react";
import { CameraIcon } from "@repo/ui/icons";

interface PartImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  fill?: boolean;
}

// Same-origin nginx proxy in production; override for local dev so images
// load without the docker stack (nginx requires the url param unencoded,
// so we can't route this through a Next.js rewrite).
const IMG_PROXY_BASE = process.env.NEXT_PUBLIC_IMG_PROXY_BASE || "/img-proxy/";

function proxyUrl(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    // Request large gallery images from eBay CDN
    const url = src.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, "/s-l1600.$1");
    return `${IMG_PROXY_BASE}?url=${url}`;
  }
  return src;
}

/**
 * Real listing photos come from many third-party seller CDNs, so we can't
 * guarantee every URL stays reachable. Routes external images through the
 * nginx proxy to bypass hotlinking restrictions. Falls back to a placeholder.
 */
export function PartImage({ src, alt, className, priority = false, fill = true }: PartImageProps) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 bg-slate-100 text-slate-300 ${fill ? "absolute inset-0 h-full w-full" : ""} ${className ?? ""}`}
        role="img"
        aria-label={`No photo available for ${alt}`}
      >
        <CameraIcon className="h-10 w-10" />
        <span className="text-[11px] font-medium text-slate-400">No photo</span>
      </div>
    );
  }

  const proxied = proxyUrl(src);

  return (
    <img
      src={proxied}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
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
