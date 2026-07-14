"use client";

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { API_BASE_URL } from '@/lib/api';

interface TicketResult {
  id: string;
  status: string;
  priority: string;
}

function SupportForm() {
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TicketResult | null>(null);
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    orderId: searchParams.get('orderId') || '',
    canonicalPartId: searchParams.get('partId') || '',
    category: searchParams.get('category') || 'FITMENT',
    subject: searchParams.get('subject') || '',
    message: '',
  });

  const updateField = (field: keyof typeof form) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE_URL}/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          orderId: form.orderId || undefined,
          canonicalPartId: form.canonicalPartId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not create support ticket.');
      setResult(data);
      setForm((prev) => ({ ...prev, message: '' }));
    } catch (err: any) {
      setError(err?.message || 'Could not create support ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">PartsBazar360 Support</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Get help with an order or compatibility question</h1>
        <p className="mt-2 text-slate-600">
          Share the order or part details and the operations team will route it to the right seller or fulfilment owner.
        </p>
      </header>

      {result ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="text-lg font-semibold text-emerald-900">Support ticket opened</h2>
          <p className="mt-2 text-sm text-emerald-800">
            Ticket <span className="font-mono">{result.id}</span> is now {result.status.toLowerCase()} with {result.priority.toLowerCase()} priority.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setResult(null)}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
            >
              Open another ticket
            </button>
            <Link href="/search" className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100">
              Back to marketplace
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input required placeholder="Full name" value={form.customerName} onChange={updateField('customerName')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input required type="email" placeholder="Email address" value={form.customerEmail} onChange={updateField('customerEmail')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <select value={form.category} onChange={updateField('category')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="FITMENT">Compatibility</option>
              <option value="ORDER_ISSUE">Order issue</option>
              <option value="PAYMENT">Payment</option>
              <option value="RETURNS">Returns</option>
              <option value="GENERAL">General</option>
            </select>
            <input placeholder="Order ID optional" value={form.orderId} onChange={updateField('orderId')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input placeholder="Part ID optional" value={form.canonicalPartId} onChange={updateField('canonicalPartId')} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <input required placeholder="Subject" value={form.subject} onChange={updateField('subject')} className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <textarea required rows={6} placeholder="Tell us what needs checking. Include vehicle year, make, model, trim, VIN if available, or the shipment issue." value={form.message} onChange={updateField('message')} className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

          {error && <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{error}</div>}

          <button disabled={submitting} className="w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">
            {submitting ? 'Opening ticket...' : 'Contact support'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<div className="px-4 py-12 text-center text-slate-500">Loading support...</div>}>
      <SupportForm />
    </Suspense>
  );
}
