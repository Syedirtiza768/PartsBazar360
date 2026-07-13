"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ProductDetailsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [part, setPart] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);

  useEffect(() => {
    // For MVP, we are using the OpenSearch search endpoint to find the part since we didn't build a specific GET /parts/:id yet.
    // In a real app, you'd fetch directly from the canonical parts table or a specific doc lookup.
    fetch(`http://localhost:3001/search/parts?q=${params.id}&vehicleConfigId=bypass`) // assuming search is flexible or we fetch directly.
      // ACTUALLY: Let's mock the fetch since the backend route specifically expects vehicleConfigId.
      // To keep it simple for the MVP, we'll pretend we fetched the part details by using the first result from a generic search if we bypass fitment.
      // But since we built the search to require vehicleConfigId, let's just show a mock PDP layout simulating the canonical part and offers.
      .finally(() => {
        setPart({
          id: params.id,
          title: "Genuine Mercedes-Benz Brake Pads",
          brand: "Mercedes-Benz",
          category: "Brakes",
          oeNumbers: ["A0004201111"],
          offers: [
            { id: "offer-1", price: 150, condition: "NEW", sellerId: "seller-1", sellerName: "Official Dealer" },
            { id: "offer-2", price: 80, condition: "USED", sellerId: "seller-2", sellerName: "All About Mercedes (Salvage)" },
          ]
        });
        setLoading(false);
      });
  }, [params.id]);

  const handleAddToCart = (offerId: string) => {
    setAddingToCart(offerId);
    setTimeout(() => {
      alert(`Added offer ${offerId} to Cart!`);
      setAddingToCart(null);
    }, 800);
  };

  if (loading) return <div className="p-24 text-center">Loading part details...</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col lg:flex-row gap-12">
        {/* Left Column - Images & Details */}
        <div className="lg:w-2/3 space-y-8">
          <div className="aspect-[4/3] bg-white border border-slate-200 rounded-2xl flex items-center justify-center">
             <svg className="w-32 h-32 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{part.title}</h1>
            <div className="flex items-center gap-4 mt-4">
              <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-sm font-medium">{part.brand}</span>
              <span className="text-slate-500 text-sm">OE: {part.oeNumbers.join(', ')}</span>
            </div>
            
            <div className="mt-8 border-t border-slate-200 pt-8">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Fitment Verification</h2>
              <div className="flex items-start gap-4 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                <div className="bg-emerald-100 p-2 rounded-full text-emerald-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-900">Fits your Mercedes C-Class W205</h3>
                  <p className="text-emerald-700 text-sm mt-1">This part has Authoritative fitment evidence proving compatibility with your vehicle.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Offers */}
        <div className="lg:w-1/3">
          <div className="sticky top-24 space-y-6">
            <h2 className="text-xl font-bold text-slate-900">Available Offers</h2>
            
            <div className="space-y-4">
              {part.offers.map((offer: any) => (
                <div key={offer.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="font-semibold text-slate-900">{offer.sellerName}</p>
                      <p className="text-sm text-slate-500 mt-0.5">Condition: {offer.condition}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-slate-900">AED {offer.price}</p>
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => handleAddToCart(offer.id)}
                    disabled={addingToCart === offer.id}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:bg-blue-400"
                  >
                    {addingToCart === offer.id ? 'Adding to Cart...' : 'Add to Cart'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
