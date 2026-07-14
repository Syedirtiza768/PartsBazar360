"use client";

import { useState } from 'react';
import { PartImage } from './PartImage';

export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const uniqueImages = [...new Set((images || []).filter(Boolean))];
  const hasImages = uniqueImages.length > 0;
  const active = hasImages ? uniqueImages[Math.min(activeIndex, uniqueImages.length - 1)] : undefined;

  return (
    <div>
      <div className="relative aspect-square bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <PartImage
          src={active}
          alt={title}
          className="object-contain p-4"
          sizes="(max-width: 1024px) 100vw, 50vw"
          priority
        />
        {hasImages && (
          <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
            {Math.min(activeIndex, uniqueImages.length - 1) + 1} / {uniqueImages.length}
          </div>
        )}
      </div>

      {uniqueImages.length > 1 && (
        <div className="mt-4 grid grid-cols-5 gap-3 sm:grid-cols-6 md:grid-cols-8">
          {uniqueImages.slice(0, 16).map((img, idx) => (
            <button
              key={img + idx}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${idx === activeIndex ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}
              aria-label={`View image ${idx + 1}`}
            >
              <PartImage src={img} alt={`${title} thumbnail ${idx + 1}`} className="object-contain p-1" />
            </button>
          ))}
        </div>
      )}

      {!hasImages && (
        <p className="mt-3 text-sm text-slate-500">No product photos available for this listing.</p>
      )}
    </div>
  );
}
