"use client";

import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { DEMO_SELLER_ID } from '@/lib/config';

export default function PricingPage() {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [basePrice, setBasePrice] = useState(100);
  const [category, setCategory] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/merchant/pricing?sellerId=${DEMO_SELLER_ID}`)
      .then((response) => response.json())
      .then((data) => setAssignments(Array.isArray(data) ? data : []))
      .catch(() => setError('Could not load commercial terms.'));
  }, []);

  const preview = async () => {
    setError(null);
    const response = await fetch(`${API_BASE_URL}/merchant/pricing/quote?sellerId=${DEMO_SELLER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerBasePrice: basePrice, category: category || undefined }),
    });
    const data = await response.json();
    if (!response.ok) { setError(data.message || 'Could not calculate price.'); return; }
    setQuote(data);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Commercial Terms</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Pricing and seller proceeds</h1>
        <p className="mt-1 text-slate-600">Review the policies assigned to your account and preview what a buyer pays.</p>
      </header>
      {error && <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4"><h2 className="font-semibold text-slate-950">Active policy assignments</h2></div>
        <div className="divide-y divide-slate-100">
          {assignments.map((assignment) => (
            <div key={assignment.id} className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div><p className="font-semibold text-slate-950">{assignment.pricingPolicy.name}</p><p className="mt-1 text-sm text-slate-500">{assignment.category || 'All categories'} · version {assignment.pricingPolicy.version} · {assignment.pricingPolicy.mode.replace(/_/g, ' ')}</p></div>
              <div className="text-right"><p className="text-2xl font-bold text-emerald-700">{(assignment.pricingPolicy.percentRate * 100).toFixed(2)}%</p><p className="text-xs text-slate-500">plus {assignment.pricingPolicy.currency} {assignment.pricingPolicy.fixedFee.toFixed(2)}</p></div>
            </div>
          ))}
          {assignments.length === 0 && <p className="p-6 text-sm text-amber-700">No active policy is assigned. Offers retain their submitted price until operations assigns commercial terms.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div><h2 className="text-lg font-semibold text-slate-950">Price preview</h2><p className="mt-1 text-sm text-slate-500">The calculation separates your submitted amount, buyer price, marketplace fee, and seller proceeds.</p></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label><span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Submitted/base amount</span><input type="number" min={0} step="0.01" value={basePrice} onChange={(event) => setBasePrice(Number(event.target.value))} className={inputClass} /></label>
          <label><span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Category optional</span><input value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} /></label>
          <button onClick={preview} className="self-end rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white">Calculate</button>
        </div>
        {quote && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 rounded-lg bg-slate-50 border border-slate-200 p-5"><Metric label="Seller base" value={quote.sellerBasePrice} currency={quote.currency} /><Metric label="Buyer price" value={quote.customerPrice} currency={quote.currency} /><Metric label="Marketplace fee" value={quote.marketplaceFee} currency={quote.currency} /><Metric label="Seller proceeds" value={quote.sellerProceeds} currency={quote.currency} /></div>}
      </section>
    </div>
  );
}

const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';
function Metric({ label, value, currency }: { label: string; value: number; currency: string }) { return <div><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-950">{currency} {Number(value).toFixed(2)}</p></div>; }
