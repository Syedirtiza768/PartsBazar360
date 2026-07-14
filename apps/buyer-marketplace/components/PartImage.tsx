"use client";

import { useState } from 'react';

function PlaceholderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1}
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

interface PartImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  fill?: boolean;
}

function proxyUrl(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    // Request larger images from eBay CDN
    let url = src;
    // Replace eBay thumbnail size with larger version
    url = url.replace(/\/s-l\d+\.jpg$/, '/s-l500.jpg');
    return `/img-proxy/?url=${url}`;
  }
  return src;
}

/**
 * Real listing photos come from many third-party seller CDNs, so we can't
 * guarantee every URL stays reachable. Routes external images through the
 * nginx proxy to bypass hotlinking restrictions. Falls back to a placeholder.
 */
export function PartImage({ src, alt, className, fill = true }: PartImageProps) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 ${className ?? ''}`}>
        <PlaceholderIcon className="w-12 h-12 text-slate-300" />
      </div>
    );
  }

  const proxied = proxyUrl(src);

  if (fill) {
    return (
      <img
        src={proxied}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className={`absolute inset-0 h-full w-full object-contain ${className ?? ''}`}
        style={{ minHeight: '100%' }}
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <img
      src={proxied}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setErrored(true)}
    />
  );
}
