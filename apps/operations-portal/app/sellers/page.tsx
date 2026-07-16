"use client";

import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';

const MODES = ['COMMISSION_ON_SELLING_PRICE', 'COST_PLUS_MARKUP', 'TARGET_MARGIN', 'FIXED_FEE', 'HYBRID_PERCENT_PLUS_FIXED'];

export default function SellerOnboardingOperationsPage() {
  const [sellers, setSellers] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: 'STANDARD_30', name: 'Standard 30% commission', mode: MODES[0], percentRate: 30, fixedFee: 0, currency: 'USD' });

  const load = async () => {
    try {
      const [sellerResponse, policyResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/operations/sellers/onboarding`),
        fetch(`${API_BASE_URL}/operations/pricing-policies`),
      ]);
      setSellers(await sellerResponse.json());
      setPolicies(await policyResponse.json());
    } catch { setError('Could not load seller operations.'); }
  };
  useEffect(() => { load(); }, []);

  const request = async (url: string, options: RequestInit) => {
    setError(null); setMessage(null);
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) { setError(data.message || 'Request failed.'); return null; }
    return data;
  };

  const createPolicy = async () => {
    const data = await request(`${API_BASE_URL}/operations/pricing-policies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, percentRate: Number(form.percentRate) / 100, fixedFee: Number(form.fixedFee), status: 'DRAFT', createdBy: 'Operations Portal' }),
    });
    if (data) { setMessage(`Created ${data.name} version ${data.version}. Activate it before assignment.`); await load(); }
  };

  const activatePolicy = async (policyId: string) => {
    const data = await request(`${API_BASE_URL}/operations/pricing-policies/${policyId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE', approvedBy: 'Operations Portal' }),
    });
    if (data) { setMessage('Pricing policy activated.'); await load(); }
  };

  const assignPolicy = async (sellerId: string) => {
    const pricingPolicyId = selectedPolicy[sellerId];
    if (!pricingPolicyId) { setError('Select an active pricing policy first.'); return; }
    const data = await request(`${API_BASE_URL}/operations/pricing-policies/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sellerId, pricingPolicyId }),
    });
    if (data) { setMessage(`Policy assigned; ${data.repricedOffers} offers repriced.`); await load(); }
  };

  const updateSeller = async (sellerId: string, status: string, verify = false) => {
    const data = await request(`${API_BASE_URL}/operations/sellers/${sellerId}/onboarding`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...(verify ? { complianceStatus: 'VERIFIED', payoutStatus: 'VERIFIED' } : {}) }),
    });
    if (data) { setMessage(`Seller moved to ${status.replace(/_/g, ' ')}.`); await load(); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <header><p className="text-sm font-semibold text-amber-700 uppercase tracking-wide">Marketplace Governance</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Seller onboarding and pricing</h1><p className="mt-1 text-slate-600">Review seller readiness, approve compliance, and assign versioned commercial terms.</p></header>
      {(error || message) && <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div><h2 className="text-lg font-semibold text-slate-950">Create a pricing-policy version</h2><p className="mt-1 text-sm text-slate-500">Thirty percent is stored as 0.30 and interpreted according to the selected mode.</p></div>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Policy code" className={inputClass} />
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Policy name" className={inputClass} />
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className={inputClass}>{MODES.map((mode) => <option key={mode}>{mode}</option>)}</select>
          <input type="number" min={0} max={99.99} step="0.01" value={form.percentRate} onChange={(e) => setForm({ ...form, percentRate: Number(e.target.value) })} placeholder="Percent" className={inputClass} />
          <input type="number" min={0} step="0.01" value={form.fixedFee} onChange={(e) => setForm({ ...form, fixedFee: Number(e.target.value) })} placeholder="Fixed fee" className={inputClass} />
          <button onClick={createPolicy} className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950">Create draft</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {policies.map((policy) => <div key={policy.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"><span className="font-semibold text-slate-800">{policy.name} v{policy.version}</span><span className="ml-2 text-slate-500">{(policy.percentRate * 100).toFixed(2)}% · {policy.status}</span>{policy.status === 'DRAFT' && <button onClick={() => activatePolicy(policy.id)} className="ml-3 font-semibold text-blue-700">Activate</button>}</div>)}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 flex justify-between"><h2 className="font-semibold text-slate-950">Seller applications</h2><span className="text-xs font-semibold text-slate-500">{sellers.length} sellers</span></div>
        <div className="divide-y divide-slate-100">
          {sellers.map((seller) => (
            <article key={seller.id} className="p-6 space-y-4">
              <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                <div><div className="flex items-center gap-3"><h3 className="text-lg font-semibold text-slate-950">{seller.name}</h3><Status status={seller.onboardingStatus} /></div><p className="mt-1 text-sm text-slate-500">{seller.profile?.legalName || 'Legal profile incomplete'} · {seller.profile?.country || 'country missing'} · {seller._count?.offers || 0} offers</p><p className="mt-1 text-xs text-slate-500">Compliance: {seller.profile?.complianceStatus || 'NOT_STARTED'} · Payout: {seller.profile?.payoutStatus || 'NOT_STARTED'} · Terms: {seller.agreementAcceptances?.length ? 'accepted' : 'missing'}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => updateSeller(seller.id, 'IDENTITY_REVIEW')} className={secondaryButton}>Identity review</button>
                  <button onClick={() => updateSeller(seller.id, 'COMMERCIAL_REVIEW', true)} className={secondaryButton}>Verify compliance & payout</button>
                  <button onClick={() => updateSeller(seller.id, 'ACTIVE')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Activate</button>
                  <button onClick={() => updateSeller(seller.id, 'NEEDS_INFORMATION')} className={secondaryButton}>Request info</button>
                </div>
              </div>
              <div className="flex flex-col md:flex-row gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <select value={selectedPolicy[seller.id] || ''} onChange={(event) => setSelectedPolicy({ ...selectedPolicy, [seller.id]: event.target.value })} className={`${inputClass} md:max-w-md`}><option value="">Select active pricing policy</option>{policies.filter((policy) => policy.status === 'ACTIVE').map((policy) => <option key={policy.id} value={policy.id}>{policy.name} v{policy.version} · {(policy.percentRate * 100).toFixed(2)}%</option>)}</select>
                <button onClick={() => assignPolicy(seller.id)} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Assign and reprice</button>
                <p className="self-center text-xs text-slate-500">Current: {seller.pricingAssignments?.map((item: any) => item.pricingPolicy.name).join(', ') || 'none'}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

const inputClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500';
const secondaryButton = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50';
function Status({ status }: { status: string }) { return <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">{status.replace(/_/g, ' ')}</span>; }
