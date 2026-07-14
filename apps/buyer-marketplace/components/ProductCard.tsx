import Link from 'next/link';
import { PartImage } from './PartImage';
import { formatPrice, lowestOfferPrice, offerCurrency } from '@/lib/format';
import type { Part } from '@/lib/types';

export function ProductCard({ part, showFitBadge = false }: { part: Part; showFitBadge?: boolean }) {
  const price = lowestOfferPrice(part.offers);
  const currency = offerCurrency(part.offers);
  const offerCount = part.offers?.length || 0;
  const image = part.imageUrls?.[0];

  return (
    <Link
      href={`/part/${part.id}`}
      className="group flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
    >
      <div className="relative aspect-square bg-slate-50 overflow-hidden">
        <PartImage
          src={image}
          alt={part.title}
          className="object-contain p-3 group-hover:scale-105 transition-transform duration-300"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        />
        {offerCount > 1 && (
          <span className="absolute top-2 right-2 text-[11px] font-semibold bg-white/95 text-slate-700 px-2 py-0.5 rounded-full shadow-sm border border-slate-200">
            {offerCount} offers
          </span>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1">
        {showFitBadge && (
          <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 w-fit mb-2">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Fits your vehicle
          </div>
        )}
        {part.brand && (
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{part.brand}</p>
        )}
        <h3 className="mt-1 text-sm font-medium text-slate-800 line-clamp-2 leading-snug flex-1">
          {part.title}
        </h3>
        {part.category && (
          <p className="mt-1 text-xs text-slate-400">{part.category}</p>
        )}
        <div className="mt-3 flex items-baseline justify-between">
          <div>
            <p className="text-[11px] text-slate-400">From</p>
            <p className="text-lg font-bold text-slate-900">{formatPrice(price, currency)}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}
