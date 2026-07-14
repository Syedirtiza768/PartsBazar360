"use client";

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/cart-context';
import { API_BASE_URL } from '@/lib/api';
import { formatPrice } from '@/lib/format';

interface OrderResult {
  order: { id: string; totalAmount: number; currency: string; sellerOrders: { id: string; subTotal: number; shippingTotal: number }[] };
  paymentIntent: { status: string; provider: string };
}

export default function CheckoutPage() {
  const { cart, subtotal, refresh } = useCart();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);

  const [form, setForm] = useState({
    name: '',
    email: '',
    line1: '',
    line2: '',
    city: '',
    country: '',
    postalCode: '',
  });

  const items = cart.items;
  const currency = items[0]?.sellerOffer?.currency || 'USD';

  const handleChange = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cart.id) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/checkout/${cart.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          name: form.name,
          shippingAddress: {
            line1: form.line1,
            line2: form.line2 || undefined,
            city: form.city,
            country: form.country,
            postalCode: form.postalCode,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Checkout failed. Please try again.');
      setResult(data);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Checkout failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 mx-auto bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="mt-6 text-3xl font-bold text-slate-900">Order Confirmed!</h1>
        <p className="mt-2 text-slate-500">Thank you — your order has been placed and is awaiting payment confirmation.</p>

        <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 text-left space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Order ID</span>
            <span className="font-mono text-slate-900">{result.order.id}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Seller shipments</span>
            <span className="text-slate-900">{result.order.sellerOrders.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Payment status</span>
            <span className="text-slate-900 capitalize">{result.paymentIntent.status.toLowerCase()}</span>
          </div>
          <div className="flex justify-between text-base font-bold border-t border-slate-100 pt-3">
            <span>Total</span>
            <span>{formatPrice(result.order.totalAmount, result.order.currency)}</span>
          </div>
        </div>

        <Link href="/search" className="mt-8 inline-block rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
          Continue Shopping
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <p className="text-lg text-slate-600">Your cart is empty.</p>
        <Link href="/search" className="mt-4 inline-block text-blue-600 font-medium hover:underline">
          Browse parts to add
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 border-b border-slate-200 pb-6 mb-8">Checkout</h1>

      <div className="flex flex-col lg:flex-row gap-10">
        <form onSubmit={handleSubmit} className="flex-1 space-y-6">
          <div>
            <h2 className="font-semibold text-slate-900 mb-3">Contact Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input required placeholder="Full name" value={form.name} onChange={handleChange('name')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input required type="email" placeholder="Email address" value={form.email} onChange={handleChange('email')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <h2 className="font-semibold text-slate-900 mb-3">Shipping Address</h2>
            <div className="grid grid-cols-1 gap-4">
              <input required placeholder="Address line 1" value={form.line1} onChange={handleChange('line1')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input placeholder="Address line 2 (optional)" value={form.line2} onChange={handleChange('line2')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <input required placeholder="City" value={form.city} onChange={handleChange('city')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input placeholder="Postal code" value={form.postalCode} onChange={handleChange('postalCode')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input required placeholder="Country" value={form.country} onChange={handleChange('country')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          {error && (
            <div className="text-sm font-medium text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:bg-blue-400"
          >
            {submitting ? 'Placing Order...' : `Place Order — ${formatPrice(subtotal, currency)}`}
          </button>
        </form>

        <div className="lg:w-80 shrink-0">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
            <h2 className="font-bold text-lg text-slate-900 mb-2">Order Summary</h2>
            {items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm text-slate-600">
                <span className="line-clamp-1 pr-2">{item.quantity}&times; {item.sellerOffer.canonicalPart?.title || 'Part'}</span>
                <span className="shrink-0">{formatPrice(item.sellerOffer.price * item.quantity, item.sellerOffer.currency)}</span>
              </div>
            ))}
            <div className="flex justify-between text-base font-bold border-t border-slate-100 pt-3">
              <span>Subtotal</span>
              <span>{formatPrice(subtotal, currency)}</span>
            </div>
            <p className="text-xs text-slate-400">Final shipping cost is calculated per seller and added to your order total.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
