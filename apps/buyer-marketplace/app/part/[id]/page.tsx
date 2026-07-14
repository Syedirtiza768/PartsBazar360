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
  const ebayCompatibility = part.compatibility || [];

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
              {part.ebayItemId && (
                <span className="text-slate-500 text-sm">eBay #{part.ebayItemId}</span>
              )}
            </div>

            {/* eBay Listing Link */}
            {part.listingUrl && (
              <div className="mt-4">
                <a
                  href={part.listingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.568 8.16c-.169 1.858-.896 3.433-.896 3.433s-.724 1.655-2.384 2.68c-1.659 1.025-2.668.5-2.668.5s1.163-.5 1.833-1.5c.67-1 .833-2.167.833-2.167s-1.5.333-2.667.333c-1.167 0-2-.5-2-.5s.5 1.333-.167 2.5c-.667 1.167-2 1.5-2 1.5s1.167.167 2.167-.5c1-.667 1.5-1.667 1.5-1.667s-.667 1-1.833 1.5c-1.167.5-2.167.333-2.167.333s.667.667 2.167.667c1.5 0 2.5-.667 3.167-1.333.667-.667 1-1.5 1.167-2.167.167-.667.333-1.5.333-1.5s.833 1.167 1.5 1.833c.667.667 1.5 1 1.5 1s-.5-.833-.833-1.667c-.333-.833-.5-1.5-.5-1.5s.667.5 1.333.833c.667.333 1.333.5 1.333.5s-.333-.667-.833-1.333c-.5-.667-1-1.167-1-1.167s.833.167 1.5.333c.667.167 1.167.333 1.167.333s-.167-.5-.667-1.167c-.5-.667-1-1-1-1s.667 0 1.167.167c.5.167.833.333.833.333s0-.5-.333-1c-.333-.5-.667-.833-.667-.833s.5-.167 1-.167c.5 0 .833.167.833.167s-.167-.5-.5-.833c-.333-.333-.667-.5-.667-.5s.5-.333 1-.333c.5 0 .833.167.833.167s-.167-.5-.5-.833z"/>
                  </svg>
                  View on eBay
                </a>
              </div>
            )}

            {/* eBay Compatibility Data */}
            {ebayCompatibility.length > 0 && (
              <div className="mt-6 border-t border-slate-200 pt-6">
                <h2 className="text-lg font-bold text-slate-900 mb-4">eBay Compatibility</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Year</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Make</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Model</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Trim</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Engine</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {ebayCompatibility.map((item: any, i: number) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="px-4 py-3 text-sm text-slate-900">{item.year || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-900">{item.make || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-900">{item.model || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-900">{item.trim || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-900">{item.engine || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

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
