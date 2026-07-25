"use client";

import { useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@repo/ui/badge';
import { Button } from '@repo/ui/button';
import { PageBody } from '@repo/ui/container';
import { EmptyState } from '@repo/ui/empty-state';
import { Input, Select } from '@repo/ui/field';
import { PageHeader } from '@repo/ui/page-header';
import { StoreIcon } from '@repo/ui/icons';
import { API_BASE_URL } from '@/lib/api';

const MODES = ['COMMISSION_ON_SELLING_PRICE', 'COST_PLUS_MARKUP', 'TARGET_MARGIN', 'FIXED_FEE', 'HYBRID_PERCENT_PLUS_FIXED'];

export default function SellerOnboardingOperationsPage() {
  // The onboarding endpoints return wide, evolving operational records;
  // model them permissively rather than duplicating the API schema here.
  type OpsRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [sellers, setSellers] = useState<OpsRecord[]>([]);
  const [policies, setPolicies] = useState<OpsRecord[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const request = async (url: string, options: RequestInit) => {
    setError(null); setMessage(null);
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) { setError(data.message || 'Request failed.'); return null; }
    return data;
  };

  const createPolicy = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      const data = await request(`${API_BASE_URL}/operations/pricing-policies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, percentRate: Number(form.percentRate) / 100, fixedFee: Number(form.fixedFee), status: 'DRAFT', createdBy: 'Operations Portal' }),
      });
      if (data) { setMessage(`Created ${data.name} version ${data.version}. Activate it before assignment.`); await load(); }
    } finally { setCreating(false); }
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

  const activePolicies = policies.filter((policy) => policy.status === 'ACTIVE');

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Marketplace governance"
        title="Seller onboarding and pricing"
        description="Review seller readiness, approve compliance, and assign versioned commercial terms."
      />

      {(error || message) && (
        <p
          role={error ? 'alert' : 'status'}
          className={`break-anywhere rounded-lg border px-4 py-3 text-sm ${
            error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {error || message}
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6" aria-labelledby="policy-heading">
        <h2 id="policy-heading" className="text-lg font-semibold text-slate-900">
          Create a pricing-policy version
        </h2>
        <p className="mt-1 text-sm text-graphite-600">
          Thirty percent is stored as 0.30 and interpreted according to the selected mode.
        </p>

        {/* One column on phones, two on tablets, four on desktop. The submit
            button is outside the grid so it never gets stretched into a cell
            the width of a numeric field. */}
        <form onSubmit={createPolicy} className="mt-4">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <Input
              label="Policy code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            <Input
              label="Policy name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Select
              label="Mode"
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value })}
              className="sm:col-span-2 xl:col-span-1"
            >
              {MODES.map((mode) => <option key={mode}>{mode}</option>)}
            </Select>
            <div className="grid grid-cols-2 gap-x-4">
              <Input
                label="Percent"
                type="number"
                min={0}
                max={99.99}
                step="0.01"
                inputMode="decimal"
                value={form.percentRate}
                onChange={(e) => setForm({ ...form, percentRate: Number(e.target.value) })}
              />
              <Input
                label="Fixed fee"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={form.fixedFee}
                onChange={(e) => setForm({ ...form, fixedFee: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="mt-4">
            <Button type="submit" loading={creating} fullWidth className="sm:w-auto">
              Create draft
            </Button>
          </div>
        </form>

        {policies.length > 0 && (
          <ul className="mt-5 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:flex-wrap">
            {policies.map((policy) => (
              <li
                key={policy.id}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-slate-800">{policy.name} v{policy.version}</span>
                <span className="text-graphite-600">
                  {(policy.percentRate * 100).toFixed(2)}% · {policy.status}
                </span>
                {policy.status === 'DRAFT' && (
                  <Button size="sm" variant="ghost" onClick={() => activatePolicy(policy.id)} className="ml-auto">
                    Activate
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card" aria-labelledby="sellers-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="sellers-heading" className="font-semibold text-slate-900">Seller applications</h2>
          <span className="text-xs font-semibold text-graphite-600">{sellers.length} sellers</span>
        </div>

        {sellers.length === 0 ? (
          <div className="p-4 sm:p-6">
            <EmptyState
              icon={<StoreIcon />}
              title={loading ? 'Loading sellers…' : 'No seller applications yet'}
              description={loading ? undefined : 'Applications appear here as sellers complete signup.'}
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sellers.map((seller) => (
              <article key={seller.id} className="space-y-4 p-4 sm:p-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <h3 className="text-base font-semibold text-slate-900 sm:text-lg">{seller.name}</h3>
                      <Badge tone="warning" size="sm">{seller.onboardingStatus.replace(/_/g, ' ')}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-graphite-600">
                      {seller.profile?.legalName || 'Legal profile incomplete'} · {seller.profile?.country || 'country missing'} · {seller._count?.offers || 0} offers
                    </p>
                    <p className="mt-1 text-xs text-graphite-600">
                      Compliance: {seller.profile?.complianceStatus || 'NOT_STARTED'} · Payout: {seller.profile?.payoutStatus || 'NOT_STARTED'} · Terms: {seller.agreementAcceptances?.length ? 'accepted' : 'missing'}
                    </p>
                  </div>
                  {/* Actions wrap into a full-width block on phones so each one
                      keeps a 44px target instead of shrinking to fit one row. */}
                  <div className="flex flex-wrap gap-2 xl:shrink-0">
                    <Button size="sm" variant="outline" onClick={() => updateSeller(seller.id, 'IDENTITY_REVIEW')}>
                      Identity review
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => updateSeller(seller.id, 'COMMERCIAL_REVIEW', true)}>
                      Verify compliance &amp; payout
                    </Button>
                    <Button size="sm" onClick={() => updateSeller(seller.id, 'ACTIVE')}>
                      Activate
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => updateSeller(seller.id, 'NEEDS_INFORMATION')}>
                      Request info
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <Select
                      label="Pricing policy"
                      value={selectedPolicy[seller.id] || ''}
                      onChange={(event) => setSelectedPolicy({ ...selectedPolicy, [seller.id]: event.target.value })}
                      className="md:max-w-md"
                    >
                      <option value="">Select active pricing policy</option>
                      {activePolicies.map((policy) => (
                        <option key={policy.id} value={policy.id}>
                          {policy.name} v{policy.version} · {(policy.percentRate * 100).toFixed(2)}%
                        </option>
                      ))}
                    </Select>
                    <Button variant="dark" onClick={() => assignPolicy(seller.id)} className="md:shrink-0">
                      Assign and reprice
                    </Button>
                  </div>
                  <p className="mt-2.5 text-xs text-graphite-600">
                    {activePolicies.length === 0
                      ? 'No active policies — activate a draft above before assigning.'
                      : `Current: ${seller.pricingAssignments?.map((item: OpsRecord) => item.pricingPolicy.name).join(', ') || 'none'}`}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </PageBody>
  );
}
