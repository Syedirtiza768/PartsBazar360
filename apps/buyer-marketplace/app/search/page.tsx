"use client";

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const vehicleConfigId = searchParams.get('vehicleConfigId');

  const [parts, setParts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vehicleConfigId) {
      router.push('/');
      return;
    }

    fetch(`http://localhost:3001/search/parts?vehicleConfigId=${vehicleConfigId}`)
      .then(res => res.json())
      .then(data => {
        setParts(data);
        setLoading(false);
      });
  }, [vehicleConfigId, router]);

  // Helper to render fitment badge based on evidence level (Mocking Evidence A as 'Exact Fit')
  const renderFitmentBadge = () => {
    // We assume if it's returned by OpenSearch for this vehicle, it fits.
    // In a real scenario, the evidence level (A-F) would be pulled from the indexed document.
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 w-fit">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        Exact Fit - OE Verified
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-6 mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Parts that fit your vehicle
        </h1>
        <p className="text-sm text-slate-500">{parts.length} results found</p>
      </div>

      {loading ? (
        <div className="text-center py-24 text-slate-500">Searching catalogues...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {parts.map((part: any) => {
            // Find lowest price
            const lowestPrice = part.offers?.reduce((min: number, offer: any) => Math.min(min, offer.price), Infinity);

            return (
              <div key={part.id} className="group relative flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden">
                <div className="aspect-[4/3] bg-slate-100 flex items-center justify-center overflow-hidden">
                  <div className="text-slate-300">
                    <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </div>
                </div>
                
                <div className="p-5 flex flex-col flex-1">
                  {renderFitmentBadge()}
                  
                  <h3 className="mt-4 text-sm font-medium text-slate-500">{part.brand}</h3>
                  <p className="mt-1 text-lg font-semibold text-slate-900 line-clamp-2">
                    <Link href={`/part/${part.id}`}>
                      <span className="absolute inset-0" />
                      {part.title}
                    </Link>
                  </p>
                  
                  <div className="mt-auto pt-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-500">Starting from</p>
                      <p className="text-xl font-bold text-slate-900">AED {lowestPrice === Infinity ? 'N/A' : lowestPrice}</p>
                    </div>
                    <div className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded">
                      {part.offers?.length || 0} Offers
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          
          {parts.length === 0 && (
            <div className="col-span-full py-24 text-center">
              <p className="text-lg text-slate-600">No parts found for this vehicle configuration.</p>
              <button onClick={() => router.push('/')} className="mt-4 text-blue-600 font-medium hover:underline">
                Try a different vehicle
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
