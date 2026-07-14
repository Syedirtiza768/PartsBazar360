import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { INTERNAL_API_URL, SITE_URL } from '@/lib/api';
import { ImageGallery } from '@/components/ImageGallery';
import { OffersPanel } from '@/components/OffersPanel';
import { lowestOfferPrice, offerCurrency } from '@/lib/format';
import type { Part } from '@/lib/types';

interface PartPageProps {
  params: Promise<{ id: string }>;
}

async function getPart(id: string): Promise<Part | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/parts/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PartPageProps): Promise<Metadata> {
  const { id } = await params;
  const part = await getPart(id);
  if (!part) return { title: 'Part Not Found | PartsBazar360' };

  const price = lowestOfferPrice(part.offers);
  const description = `${part.title}${part.brand ? ` — ${part.brand}` : ''}${part.category ? ` (${part.category})` : ''}. ${part.offers.length} offer(s) from verified sellers${price ? `, starting at ${offerCurrency(part.offers)} ${price.toFixed(2)}` : ''}.`;
  const image = part.imageUrls?.[0];

  return {
    title: `${part.title} | PartsBazar360`,
    description,
    alternates: { canonical: `${SITE_URL}/part/${id}` },
    openGraph: {
      title: part.title,
      description,
      type: 'website',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: part.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductDetailsPage({ params }: PartPageProps) {
  const { id } = await params;
  const part = await getPart(id);

  if (!part) {
    notFound();
  }

  const images = part.imageUrls || [];
  const compatibleVehicles = part.compatibleVehicles || [];
  const hasFitment = compatibleVehicles.length > 0;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: part.title,
    brand: part.brand ? { '@type': 'Brand', name: part.brand } : undefined,
    category: part.category || undefined,
    image: images.length > 0 ? images : undefined,
    sku: part.id,
    mpn: part.oeNumbers?.[0] || undefined,
    offers: part.offers.length > 0
      ? {
          '@type': 'AggregateOffer',
          priceCurrency: offerCurrency(part.offers),
          lowPrice: lowestOfferPrice(part.offers),
          highPrice: Math.max(...part.offers.map((o) => o.price)),
          offerCount: part.offers.length,
          availability: 'https://schema.org/InStock',
        }
      : undefined,
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="text-sm text-slate-500 mb-6" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-blue-600">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/search" className="hover:text-blue-600">Shop All Parts</Link>
        {part.category && (
          <>
            <span className="mx-2">/</span>
            <Link href={`/search?category=${encodeURIComponent(part.category)}`} className="hover:text-blue-600">{part.category}</Link>
          </>
        )}
      </nav>

      <div className="flex flex-col lg:flex-row gap-12">
        {/* Left Column - Images & Details */}
        <div className="lg:w-2/3 space-y-8">
          <ImageGallery images={images} title={part.title} />

          <div>
            <h1 className="text-3xl font-bold text-slate-900">{part.title}</h1>
            <div className="flex items-center gap-3 mt-4 flex-wrap">
              {part.brand && (
                <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-sm font-medium">{part.brand}</span>
              )}
              {part.category && (
                <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium">{part.category}</span>
              )}
              {part.oeNumbers && part.oeNumbers.length > 0 && (
                <span className="text-slate-500 text-sm">OE: {part.oeNumbers.join(', ')}</span>
              )}
            </div>

            <div className="mt-8 border-t border-slate-200 pt-8">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Fitment Verification</h2>
              {hasFitment ? (
                <div className="flex items-start gap-4 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <div className="bg-emerald-100 p-2 rounded-full text-emerald-600 shrink-0">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-emerald-900">Fits the following vehicle(s)</h3>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {compatibleVehicles.map((v, i) => (
                        <li key={i}>
                          <Link
                            href={`/search?q=${encodeURIComponent(`${v.make} ${v.model}`)}`}
                            className="inline-flex items-center bg-white border border-emerald-200 text-emerald-800 px-3 py-1 rounded-full text-sm font-medium hover:border-emerald-400"
                          >
                            {v.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <p className="text-emerald-700 text-xs mt-3">
                      Auto-matched from the listing details (unverified) — confirm exact trim/engine compatibility with the seller before purchase.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-4 p-4 bg-amber-50 border border-amber-100 rounded-xl">
                  <div className="bg-amber-100 p-2 rounded-full text-amber-600">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-amber-900">Fitment not yet verified</h3>
                    <p className="text-amber-700 text-sm mt-1">Check the listing title and OE numbers, or contact the seller to confirm compatibility with your vehicle.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Offers */}
        <div className="lg:w-1/3">
          <div className="sticky top-24">
            <OffersPanel offers={part.offers} />
          </div>
        </div>
      </div>
    </div>
  );
}
