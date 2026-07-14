"use client";

import { useState } from 'react';
import { useCart } from '@/lib/cart-context';
import { formatPrice } from '@/lib/format';
import type { Offer } from '@/lib/types';

export function OffersPanel({ offers }: { offers: Offer[] }) {
  const { addToCart } = useCart();
  const [addingToCart, setAddingToCart] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const sorted = [...offers].sort((a, b) => a.price - b.price);

  const handleAddToCart = async (offerId: string) => {
    setAddingToCart(offerId);
    setFeedback(null);
    try {
      await addToCart(offerId, 1);
      setFeedback('Added to cart!');
    } catch (err: any) {
      setFeedback(err?.message || 'Could not add item to cart.');
    } finally {
      setAddingToCart(null);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-900">
        Available Offers <span className="text-slate-400 font-normal text-base">({sorted.length})</span>
      </h2>

      {feedback && (
        <div className="text-sm font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2">
          {feedback}
        </div>
      )}

      <div className="space-y-4">
        {sorted.length === 0 && (
          <p className="text-sm text-slate-500">No active offers for this part right now.</p>
        )}
        {sorted.map((offer, idx) => (
          <div key={offer.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div>
                {idx === 0 && sorted.length > 1 && (
                  <span className="inline-block text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full mb-1.5">
                    Best price
                  </span>
                )}
                <p className="font-semibold text-slate-900">{offer.seller?.name || offer.sellerName || 'Marketplace Seller'}</p>
                <p className="text-sm text-slate-500 mt-0.5">Condition: {offer.condition}</p>
                {(offer.partSource || offer.qualityTier) && (
                  <p className="text-xs font-medium text-emerald-700 mt-1">
                    {[offer.partSource, offer.qualityTier].filter(Boolean).join(' ').replace(/_/g, ' ')}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900">{formatPrice(offer.price, offer.currency)}</p>
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
  );
}
