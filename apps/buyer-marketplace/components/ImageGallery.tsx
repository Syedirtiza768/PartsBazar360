"use client";

import { useState } from 'react';
import { PartImage } from './PartImage';

export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const hasImages = images.length > 0;

  return (
    <div>
      <div className="relative aspect-square bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <PartImage
          src={hasImages ? images[activeIndex] : undefined}
          alt={title}
          className="object-contain p-6"
          sizes="(max-width: 1024px) 100vw, 50vw"
          priority
        />
      </div>

      {images.length > 1 && (
        <div className="mt-4 grid grid-cols-5 gap-3">
          {images.slice(0, 10).map((img, idx) => (
            <button
              key={img + idx}
              onClick={() => setActiveIndex(idx)}
              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${idx === activeIndex ? 'border-blue-500' : 'border-slate-200 hover:border-slate-300'}`}
              aria-label={`View image ${idx + 1}`}
            >
              <PartImage src={img} alt={`${title} thumbnail ${idx + 1}`} className="object-contain p-1" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
