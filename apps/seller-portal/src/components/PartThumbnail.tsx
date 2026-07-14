"use client";

import { useState } from 'react';

function proxyUrl(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    // Request larger images from eBay CDN
    let url = src;
    // Replace eBay thumbnail size with larger version
    url = url.replace(/\/s-l\d+\.jpg$/, '/s-l500.jpg');
    return `/img-proxy/?url=${encodeURIComponent(url)}`;
  }
  return src;
}

/**
 * Small listing-photo thumbnail for tables/lists. Falls back to a generic
 * icon tile if there's no image or the remote URL fails to load (photos are
 * hosted on many different third-party seller CDNs).
 */
export function PartThumbnail({ src, alt, size = 48 }: { src?: string | null; alt: string; size?: number }) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center bg-zinc-800 border border-zinc-700 rounded-md shrink-0"
      >
        <svg className="w-1/2 h-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ width: size, height: size }} className="relative shrink-0 bg-zinc-800 border border-zinc-700 rounded-md overflow-hidden">
      <img
        src={proxyUrl(src)}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="absolute inset-0 w-full h-full object-contain p-1"
        onError={() => setErrored(true)}
      />
    </div>
  );
}
