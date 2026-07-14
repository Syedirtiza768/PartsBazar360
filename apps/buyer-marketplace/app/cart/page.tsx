"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/cart-context';
import { PartImage } from '@/components/PartImage';
import { formatPrice } from '@/lib/format';

export default function CartPage() {
  const { cart, subtotal, updateQuantity, removeItem, loading } = useCart();
  const router = useRouter();
  const items = cart.items;
  const currency = items[0]?.sellerOffer?.currency || 'USD';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 border-b border-slate-200 pb-6 mb-8">
        Your Cart {items.length > 0 && <span className="text-slate-400 font-normal text-xl">({items.length})</span>}
      </h1>

      {items.length === 0 ? (
        <div className="text-center py-24 bg-white border border-slate-200 rounded-2xl">
          <p className="text-lg text-slate-600">Your cart is empty.</p>
          <Link href="/search" className="mt-4 inline-block text-blue-600 font-medium hover:underline">
            Browse parts to add
          </Link>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-10">
          <div className="flex-1 space-y-4">
            {items.map((item) => {
              const part = item.sellerOffer.canonicalPart;
              const image = part?.imageUrls?.[0];
              return (
                <div key={item.id} className="flex gap-4 bg-white border border-slate-200 rounded-xl p-4">
                  <Link href={part ? `/part/${part.id}` : '#'} className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-slate-50">
                    <PartImage src={image} alt={part?.title || 'Part'} className="object-contain p-1" />
                  </Link>

                  <div className="flex-1 min-w-0">
                    <Link href={part ? `/part/${part.id}` : '#'} className="font-medium text-slate-900 hover:text-blue-600 line-clamp-2">
                      {part?.title || 'Part'}
                    </Link>
                    <p className="text-sm text-slate-500 mt-1">
                      Sold by {item.sellerOffer.seller?.name || 'Marketplace Seller'} &middot; {item.sellerOffer.condition}
                    </p>

                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center border border-slate-200 rounded-lg">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          disabled={loading}
                          className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                          aria-label="Decrease quantity"
                        >
                          &minus;
                        </button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={loading}
                          className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="font-semibold text-slate-900">
                          {formatPrice(item.sellerOffer.price * item.quantity, item.sellerOffer.currency)}
                        </span>
                        <button
                          onClick={() => removeItem(item.id)}
                          disabled={loading}
                          className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                          aria-label="Remove item"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lg:w-80 shrink-0">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sticky top-24 space-y-4">
              <h2 className="font-bold text-lg text-slate-900">Order Summary</h2>
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal, currency)}</span>
              </div>
              <p className="text-xs text-slate-400">Shipping is calculated per-seller at checkout.</p>
              <button
                onClick={() => router.push('/checkout')}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
              >
                Proceed to Checkout
              </button>
              <Link href="/search" className="block text-center text-sm text-blue-600 hover:underline">
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
