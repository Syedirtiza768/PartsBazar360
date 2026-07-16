"use client";

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { DEMO_SELLER_ID } from '@/lib/config';

const INITIAL_PROFILE = {
  accountType: 'BUSINESS', legalName: '', tradingName: '', registrationNumber: '', taxId: '',
  website: '', phone: '', supportEmail: '', country: '', fulfillmentSlaHours: 48,
  returnWindowDays: 30, acceptsReturns: true, warrantyDays: 0,
  supportedCategories: '', supportedConditions: 'NEW, USED, REFURBISHED', shippingRegions: '', freightCapable: false,
};

export default function OnboardingPage() {
  const [seller, setSeller] = useState<any>(null);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [acceptedByEmail, setAcceptedByEmail] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/merchant/onboarding?sellerId=${DEMO_SELLER_ID}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load onboarding.');
      setSeller(data);
      if (data.profile) {
        setProfile({
          ...INITIAL_PROFILE,
          ...data.profile,
          supportedCategories: (data.profile.supportedCategories || []).join(', '),
          supportedConditions: (data.profile.supportedConditions || []).join(', '),
          shippingRegions: (data.profile.shippingRegions || []).join(', '),
        });
        setAcceptedByEmail(data.profile.supportEmail || '');
      }
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const completed = useMemo(() => [profile.legalName, profile.country, profile.phone, profile.supportEmail]
    .filter(Boolean).length, [profile]);

  const update = (key: keyof typeof INITIAL_PROFILE) => (event: any) => {
    const value = event.target.type === 'checkbox'
      ? event.target.checked
      : event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    setSaving(true); setError(null); setMessage(null);
    try {
      const payload = {
        ...profile,
        supportedCategories: split(profile.supportedCategories),
        supportedConditions: split(profile.supportedConditions),
        shippingRegions: split(profile.shippingRegions),
      };
      const response = await fetch(`${API_BASE_URL}/merchant/onboarding/profile?sellerId=${DEMO_SELLER_ID}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not save profile.');
      setSeller(data); setMessage('Business profile saved.');
      return true;
    } catch (caught: any) {
      setError(caught.message); return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!acceptTerms) { setError('Accept the marketplace seller terms before submitting.'); return; }
    if (!(await save())) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/merchant/onboarding/submit?sellerId=${DEMO_SELLER_ID}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptedByEmail, agreementVersion: '2026-07' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not submit onboarding.');
      setSeller(data); setMessage('Application submitted for review.');
    } catch (caught: any) { setError(caught.message); } finally { setSaving(false); }
  };

  if (loading) return <div className="p-8 text-slate-500">Loading business onboarding...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div><p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Seller Readiness</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Business onboarding</h1><p className="mt-1 text-slate-600">Complete your legal, service, returns, and fulfilment profile before activation.</p></div>
        <StatusBadge status={seller?.onboardingStatus || 'DRAFT'} />
      </header>

      {(error || message) && <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Step label="Business details" done={completed === 4} />
        <Step label="Terms accepted" done={(seller?.agreementAcceptances || []).length > 0} />
        <Step label="Compliance" done={seller?.profile?.complianceStatus === 'VERIFIED'} />
        <Step label="Payout account" done={seller?.profile?.payoutStatus === 'VERIFIED'} />
      </div>

      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-7">
        <SectionTitle title="Legal business" detail="Use details that match registration, tax, and payout documents." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Account type"><select value={profile.accountType} onChange={update('accountType')} className={inputClass}><option>BUSINESS</option><option>INDIVIDUAL</option></select></Field>
          <Field label="Legal name *"><input value={profile.legalName} onChange={update('legalName')} className={inputClass} /></Field>
          <Field label="Trading name"><input value={profile.tradingName} onChange={update('tradingName')} className={inputClass} /></Field>
          <Field label="Registration number"><input value={profile.registrationNumber} onChange={update('registrationNumber')} className={inputClass} /></Field>
          <Field label="Tax ID"><input value={profile.taxId} onChange={update('taxId')} className={inputClass} /></Field>
          <Field label="Country *"><input value={profile.country} onChange={update('country')} className={inputClass} /></Field>
          <Field label="Phone *"><input value={profile.phone} onChange={update('phone')} className={inputClass} /></Field>
          <Field label="Support email *"><input type="email" value={profile.supportEmail} onChange={update('supportEmail')} className={inputClass} /></Field>
          <Field label="Website"><input value={profile.website} onChange={update('website')} className={inputClass} /></Field>
        </div>

        <SectionTitle title="Operating terms" detail="These values are shown to customers and used by operations." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Fulfilment SLA (hours)"><input type="number" min={1} value={profile.fulfillmentSlaHours} onChange={update('fulfillmentSlaHours')} className={inputClass} /></Field>
          <Field label="Return window (days)"><input type="number" min={0} value={profile.returnWindowDays} onChange={update('returnWindowDays')} className={inputClass} /></Field>
          <Field label="Warranty (days)"><input type="number" min={0} value={profile.warrantyDays} onChange={update('warrantyDays')} className={inputClass} /></Field>
          <Field label="Categories"><input value={profile.supportedCategories} onChange={update('supportedCategories')} placeholder="Engine, Body, Electrical" className={inputClass} /></Field>
          <Field label="Conditions"><input value={profile.supportedConditions} onChange={update('supportedConditions')} className={inputClass} /></Field>
          <Field label="Shipping regions"><input value={profile.shippingRegions} onChange={update('shippingRegions')} placeholder="US, UK, EU" className={inputClass} /></Field>
        </div>
        <div className="flex flex-wrap gap-6 text-sm text-slate-700">
          <label className="flex items-center gap-2"><input type="checkbox" checked={profile.acceptsReturns} onChange={update('acceptsReturns')} /> Accepts returns</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={profile.freightCapable} onChange={update('freightCapable')} /> Can ship freight/oversized parts</label>
        </div>
        <div className="flex justify-end"><button disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save profile'}</button></div>
      </form>

      {['DRAFT', 'NEEDS_INFORMATION'].includes(seller?.onboardingStatus) && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <SectionTitle title="Submit for review" detail="Your profile becomes review-only after submission. Operations may request more information." />
          <input type="email" value={acceptedByEmail} onChange={(event) => setAcceptedByEmail(event.target.value)} placeholder="Authorized signatory email" className={inputClass} />
          <label className="flex items-start gap-3 text-sm text-slate-700"><input className="mt-1" type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} /><span>I am authorized to accept Marketplace Seller Terms version 2026-07 and confirm that the supplied information is accurate.</span></label>
          <button type="button" onClick={submit} disabled={saving || completed < 4} className="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Submit application</button>
        </section>
      )}
    </div>
  );
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500';
const split = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>; }
function SectionTitle({ title, detail }: { title: string; detail: string }) { return <div><h2 className="text-lg font-semibold text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">{detail}</p></div>; }
function Step({ label, done }: { label: string; done: boolean }) { return <div className={`rounded-lg border p-4 ${done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}><p className={`text-sm font-semibold ${done ? 'text-emerald-700' : 'text-slate-600'}`}>{done ? '✓ ' : ''}{label}</p></div>; }
function StatusBadge({ status }: { status: string }) { return <span className="w-fit rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">{status.replace(/_/g, ' ')}</span>; }
