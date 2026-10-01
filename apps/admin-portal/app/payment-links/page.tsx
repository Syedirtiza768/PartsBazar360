"use client";

import { useState, type FormEvent } from "react";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { Input } from "@repo/ui/field";
import { PageHeader } from "@repo/ui/page-header";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { useAdminAuth } from "@/lib/auth-context";

type PaymentLink = {
  id: string;
  url: string;
  name: string;
  amount: number;
  currency: "AED" | "USD";
  reference: string | null;
  livemode: boolean;
};

type FormState = {
  name: string;
  description: string;
  amount: string;
  currency: "AED" | "USD";
  reference: string;
};

const EMPTY: FormState = {
  name: "",
  description: "",
  amount: "",
  currency: "AED",
  reference: "",
};

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => null);
  if (typeof body?.message === "string") return body.message;
  if (Array.isArray(body?.message)) return body.message.join(", ");
  return "Could not create the Stripe payment link.";
}

export default function PaymentLinksPage() {
  const { token, user } = useAdminAuth();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [paymentLink, setPaymentLink] = useState<PaymentLink | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createPaymentLink(event: FormEvent) {
    event.preventDefault();
    if (!token || user?.role !== "ADMIN") return;

    const amount = Number(form.amount);
    if (
      !form.name.trim() ||
      !Number.isFinite(amount) ||
      amount < (form.currency === "AED" ? 2 : 0.5) ||
      Math.abs(Math.round(amount * 100) - amount * 100) > 1e-7
    ) {
      setError(
        `Enter a payment description and an amount of at least ${form.currency === "AED" ? "2.00 AED" : "0.50 USD"} with up to two decimals.`,
      );
      return;
    }

    setSaving(true);
    setError(null);
    setCopied(false);
    setPaymentLink(null);
    try {
      const response = await apiFetch(
        token,
        `${API_BASE_URL}/admin/payment-links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            amount,
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            reference: form.reference.trim() || undefined,
          }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      setPaymentLink((await response.json()) as PaymentLink);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create the Stripe payment link.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(paymentLink.url);
      setCopied(true);
    } catch {
      setError("Copy was unavailable. Select and copy the payment link instead.");
    }
  }

  if (user && user.role !== "ADMIN") {
    return (
      <PageBody size="wide">
        <PageHeader
          eyebrow="Payments"
          title="Payment links"
          description="Payment link generation is restricted to platform administrators."
        />
      </PageBody>
    );
  }

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Payments"
        title="Payment links"
        description="Create a hosted Stripe link for a fixed, one-time payment."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <form
          onSubmit={createPaymentLink}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
        >
          <div>
            <h2 className="text-xl font-bold text-slate-950">
              Generate a link
            </h2>
            <p className="mt-1 text-sm text-graphite-600">
              Stripe hosts checkout and collects the payment details.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
            >
              {error}
            </p>
          )}

          <Input
            label="Payment description"
            required
            maxLength={120}
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Part payment or service fee"
          />
          <Input
            label="Checkout details"
            maxLength={500}
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            placeholder="Optional details shown with the payment"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Amount"
              required
              type="number"
              min={form.currency === "AED" ? "2" : "0.5"}
              max="999999.99"
              step="0.01"
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({ ...current, amount: event.target.value }))
              }
              placeholder="0.00"
              hint={
                form.currency === "AED"
                  ? "Minimum payment: 2.00 AED."
                  : "Minimum payment: 0.50 USD."
              }
            />
            <div className="space-y-1.5">
              <label
                htmlFor="payment-currency"
                className="block text-sm font-medium text-slate-800"
              >
                Currency
              </label>
              <select
                id="payment-currency"
                value={form.currency}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    currency: event.target.value as FormState["currency"],
                  }))
                }
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="AED">AED — UAE dirham</option>
                <option value="USD">USD — US dollar</option>
              </select>
            </div>
          </div>

          <Input
            label="Reference (optional)"
            maxLength={80}
            value={form.reference}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                reference: event.target.value,
              }))
            }
            placeholder="Order number or internal reference"
            hint="Stored in Stripe metadata for reconciliation."
          />

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Each link accepts one completed payment. Payments are recorded in
            Stripe and are not attached to marketplace orders.
          </div>

          <Button type="submit" loading={saving}>
            Generate payment link
          </Button>
        </form>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-slate-950">Generated link</h2>
            {paymentLink && (
              <Badge tone={paymentLink.livemode ? "success" : "warning"}>
                {paymentLink.livemode ? "Live" : "Test mode"}
              </Badge>
            )}
          </div>
          {!paymentLink ? (
            <p className="mt-3 text-sm text-graphite-600">
              Your new Stripe link will appear here.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              <div>
                <p className="font-semibold text-slate-950">{paymentLink.name}</p>
                <p className="mt-1 text-sm text-graphite-600">
                  {new Intl.NumberFormat("en", {
                    style: "currency",
                    currency: paymentLink.currency,
                  }).format(paymentLink.amount)}
                  {paymentLink.reference ? ` · ${paymentLink.reference}` : ""}
                </p>
              </div>
              <div>
                <label
                  htmlFor="generated-payment-link"
                  className="block text-xs font-semibold uppercase tracking-wide text-graphite-600"
                >
                  Shareable Stripe URL
                </label>
                <input
                  id="generated-payment-link"
                  readOnly
                  value={paymentLink.url}
                  onFocus={(event) => event.currentTarget.select()}
                  className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={copyLink} variant="secondary">
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <a
                  href={paymentLink.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-brand-700 underline-offset-4 hover:underline"
                >
                  Open checkout
                </a>
              </div>
              <p className="text-xs text-graphite-600">
                Stripe link ID: {paymentLink.id}
              </p>
            </div>
          )}
        </section>
      </div>
    </PageBody>
  );
}
