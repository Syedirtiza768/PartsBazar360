"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@repo/ui/button";
import { Input, Select, Checkbox } from "@repo/ui/field";
import { Skeleton } from "@repo/ui/skeleton";
import { CheckCircleIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { API_BASE_URL } from "@/lib/api";
import { DEMO_SELLER_ID } from "@/lib/config";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const INITIAL_PROFILE = {
  accountType: "BUSINESS",
  legalName: "",
  tradingName: "",
  registrationNumber: "",
  taxId: "",
  website: "",
  phone: "",
  supportEmail: "",
  country: "",
  fulfillmentSlaHours: 48,
  returnWindowDays: 30,
  acceptsReturns: true,
  warrantyDays: 0,
  supportedCategories: "",
  supportedConditions: "NEW, USED, REFURBISHED",
  shippingRegions: "",
  freightCapable: false,
};

type Profile = typeof INITIAL_PROFILE;

const split = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

function StepPill({ label, done, index }: { label: string; done: boolean; index: number }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border p-3.5",
        done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          done ? "bg-emerald-500 text-white" : "border border-slate-300 bg-white text-slate-400",
        )}
        aria-hidden="true"
      >
        {done ? "✓" : index}
      </span>
      <span className={cn("text-sm font-semibold", done ? "text-emerald-800" : "text-slate-600")}>{label}</span>
    </div>
  );
}

export default function OnboardingPage() {
  const [seller, setSeller] = useState<any>(null);
  const [profile, setProfile] = useState<Profile>(INITIAL_PROFILE);
  const [acceptedByEmail, setAcceptedByEmail] = useState("");
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
      if (!response.ok) throw new Error(data.message || "Could not load onboarding.");
      setSeller(data);
      if (data.profile) {
        setProfile({
          ...INITIAL_PROFILE,
          ...data.profile,
          supportedCategories: (data.profile.supportedCategories || []).join(", "),
          supportedConditions: (data.profile.supportedConditions || []).join(", "),
          shippingRegions: (data.profile.shippingRegions || []).join(", "),
        });
        setAcceptedByEmail(data.profile.supportEmail || "");
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not load onboarding.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const completed = useMemo(
    () => [profile.legalName, profile.country, profile.phone, profile.supportEmail].filter(Boolean).length,
    [profile],
  );

  const update =
    (key: keyof Profile) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target as HTMLInputElement;
      const value =
        target.type === "checkbox" ? target.checked : target.type === "number" ? Number(target.value) : target.value;
      setProfile((current) => ({ ...current, [key]: value }));
    };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        ...profile,
        supportedCategories: split(profile.supportedCategories),
        supportedConditions: split(profile.supportedConditions),
        shippingRegions: split(profile.shippingRegions),
      };
      const response = await fetch(`${API_BASE_URL}/merchant/onboarding/profile?sellerId=${DEMO_SELLER_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not save profile.");
      setSeller(data);
      setMessage("Business profile saved.");
      return true;
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save profile.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!acceptTerms) {
      setError("Accept the marketplace seller terms before submitting.");
      return;
    }
    if (!(await save())) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/merchant/onboarding/submit?sellerId=${DEMO_SELLER_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptedByEmail, agreementVersion: "2026-07" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not submit onboarding.");
      setSeller(data);
      setMessage("Application submitted for review.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not submit onboarding.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[420px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Seller readiness"
        title="Business onboarding"
        description="Complete your legal, service, returns, and fulfilment profile before activation."
        actions={<StatusBadge status={seller?.onboardingStatus || "DRAFT"} />}
      />

      {(error || message) && (
        <div
          role={error ? "alert" : "status"}
          className={cn(
            "rounded-xl border px-4 py-3 text-sm font-medium",
            error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {error || message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StepPill index={1} label="Business details" done={completed === 4} />
        <StepPill index={2} label="Terms accepted" done={(seller?.agreementAcceptances || []).length > 0} />
        <StepPill index={3} label="Compliance" done={seller?.profile?.complianceStatus === "VERIFIED"} />
        <StepPill index={4} label="Payout account" done={seller?.profile?.payoutStatus === "VERIFIED"} />
      </div>

      <form onSubmit={save} className="space-y-8 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-7">
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Legal business</h2>
          <p className="mt-1 text-sm text-slate-500">
            Use details that match registration, tax, and payout documents.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select label="Account type" value={profile.accountType} onChange={update("accountType")}>
              <option value="BUSINESS">Business</option>
              <option value="INDIVIDUAL">Individual</option>
            </Select>
            <Input label="Legal name" required value={profile.legalName} onChange={update("legalName")} />
            <Input label="Trading name" value={profile.tradingName} onChange={update("tradingName")} />
            <Input label="Registration number" value={profile.registrationNumber} onChange={update("registrationNumber")} />
            <Input label="Tax ID" value={profile.taxId} onChange={update("taxId")} />
            <Input label="Country" required value={profile.country} onChange={update("country")} />
            <Input label="Phone" required type="tel" value={profile.phone} onChange={update("phone")} />
            <Input label="Support email" required type="email" value={profile.supportEmail} onChange={update("supportEmail")} />
            <Input label="Website" value={profile.website} onChange={update("website")} placeholder="https://" />
          </div>
        </section>

        <section className="border-t border-slate-100 pt-7">
          <h2 className="text-lg font-semibold text-slate-900">Operating terms</h2>
          <p className="mt-1 text-sm text-slate-500">
            Shown to customers on your listings and used by operations.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              label="Fulfilment SLA (hours)"
              type="number"
              min={1}
              value={profile.fulfillmentSlaHours}
              onChange={update("fulfillmentSlaHours")}
              hint="Time from paid order to handover"
            />
            <Input
              label="Return window (days)"
              type="number"
              min={0}
              value={profile.returnWindowDays}
              onChange={update("returnWindowDays")}
            />
            <Input
              label="Warranty (days)"
              type="number"
              min={0}
              value={profile.warrantyDays}
              onChange={update("warrantyDays")}
              hint="0 = no seller warranty"
            />
            <Input
              label="Categories"
              value={profile.supportedCategories}
              onChange={update("supportedCategories")}
              placeholder="Engine, Body, Electrical"
              hint="Comma-separated"
            />
            <Input
              label="Conditions"
              value={profile.supportedConditions}
              onChange={update("supportedConditions")}
              hint="Comma-separated"
            />
            <Input
              label="Shipping regions"
              value={profile.shippingRegions}
              onChange={update("shippingRegions")}
              placeholder="US, UK, EU"
              hint="Comma-separated"
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            <Checkbox checked={profile.acceptsReturns} onChange={update("acceptsReturns")} label="Accepts returns" />
            <Checkbox
              checked={profile.freightCapable}
              onChange={update("freightCapable")}
              label="Can ship freight / oversized parts"
            />
          </div>
        </section>

        <div className="flex justify-end border-t border-slate-100 pt-5">
          <Button type="submit" loading={saving}>
            Save profile
          </Button>
        </div>
      </form>

      {["DRAFT", "NEEDS_INFORMATION"].includes(seller?.onboardingStatus) && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-7">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Submit for review</h2>
            <p className="mt-1 text-sm text-slate-500">
              Your profile becomes review-only after submission. Operations may request more information.
            </p>
          </div>
          <Input
            label="Authorized signatory email"
            type="email"
            value={acceptedByEmail}
            onChange={(event) => setAcceptedByEmail(event.target.value)}
          />
          <Checkbox
            checked={acceptTerms}
            onChange={(event) => setAcceptTerms(event.target.checked)}
            label="I am authorized to accept Marketplace Seller Terms version 2026-07 and confirm that the supplied information is accurate."
          />
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
              {completed}/4 required business details completed
            </p>
            <Button variant="dark" onClick={submit} disabled={saving || completed < 4} loading={saving}>
              Submit application
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
