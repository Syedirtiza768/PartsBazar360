"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, buttonClasses } from "@repo/ui/button";
import { Input, Select, Textarea } from "@repo/ui/field";
import { Skeleton } from "@repo/ui/skeleton";
import {
  CheckCircleIcon,
  MessageIcon,
  ShieldCheckIcon,
  ClockIcon,
  TagIcon,
} from "@repo/ui/icons";
import { API_BASE_URL } from "@/lib/api";

interface TicketResult {
  id: string;
  status: string;
  priority: string;
}

const CATEGORIES = [
  { value: "FITMENT", label: "Fitment / compatibility check" },
  { value: "ORDER_ISSUE", label: "Order issue" },
  { value: "PAYMENT", label: "Payment" },
  { value: "RETURNS", label: "Returns & refunds" },
  { value: "GENERAL", label: "General question" },
];

function SupportForm() {
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TicketResult | null>(null);
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    orderId: searchParams.get("orderId") || "",
    canonicalPartId: searchParams.get("partId") || "",
    category: searchParams.get("category") || "FITMENT",
    subject: searchParams.get("subject") || "",
    message: "",
  });

  const hasContext = Boolean(form.orderId || form.canonicalPartId);

  const updateField =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          orderId: form.orderId || undefined,
          canonicalPartId: form.canonicalPartId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not create support ticket.");
      setResult(data);
      setForm((prev) => ({ ...prev, message: "" }));
      window.scrollTo({ top: 0 });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create support ticket.");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center sm:p-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircleIcon className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900 sm:text-2xl">Ticket opened</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Ticket <span className="part-number font-semibold text-slate-900">{result.id}</span> is{" "}
            {result.status.toLowerCase()} with {result.priority.toLowerCase()} priority. Our team
            replies by email — usually within one business day.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => setResult(null)} className={buttonClasses({ variant: "outline" })}>
              Open another ticket
            </button>
            <Link href="/search" className={buttonClasses()}>
              Back to the marketplace
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_320px]">
        <div>
          <header>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Get help from a human
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500 sm:text-base">
              Compatibility checks, order issues, returns — describe it once and we route it to the
              right seller or fulfilment owner.
            </p>
          </header>

          {hasContext && (
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
              <TagIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <p className="text-sm text-brand-900">
                This ticket is linked to{" "}
                {form.orderId && (
                  <>
                    order <span className="part-number font-semibold">{form.orderId}</span>
                  </>
                )}
                {form.orderId && form.canonicalPartId && " and "}
                {form.canonicalPartId && (
                  <>
                    part <span className="part-number font-semibold">{form.canonicalPartId}</span>
                  </>
                )}
                {" — "}we&apos;ll have the full context.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Full name"
                autoComplete="name"
                required
                value={form.customerName}
                onChange={updateField("customerName")}
              />
              <Input
                label="Email address"
                type="email"
                autoComplete="email"
                required
                value={form.customerEmail}
                onChange={updateField("customerEmail")}
              />
            </div>

            <Select label="What is this about?" value={form.category} onChange={updateField("category")}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Order ID"
                hint="Optional — from your confirmation email"
                value={form.orderId}
                onChange={updateField("orderId")}
              />
              <Input
                label="Part ID"
                hint="Optional — filled automatically from a listing"
                value={form.canonicalPartId}
                onChange={updateField("canonicalPartId")}
              />
            </div>

            <Input label="Subject" required value={form.subject} onChange={updateField("subject")} />

            <Textarea
              label="How can we help?"
              required
              rows={6}
              hint="For fitment checks: include year, make, model, trim, engine — or the VIN."
              value={form.message}
              onChange={updateField("message")}
            />

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700" role="alert">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" fullWidth loading={submitting}>
              Open support ticket
            </Button>
          </form>
        </div>

        <aside className="space-y-4 lg:pt-20" aria-label="What to expect">
          {[
            {
              icon: <ShieldCheckIcon className="h-5 w-5 text-emerald-500" />,
              title: "Fitment verification",
              desc: "Send your vehicle details and the part — we check OE numbers and compatibility evidence before you commit.",
            },
            {
              icon: <ClockIcon className="h-5 w-5 text-slate-400" />,
              title: "Response time",
              desc: "Most tickets get a first reply within one business day.",
            },
            {
              icon: <MessageIcon className="h-5 w-5 text-slate-400" />,
              title: "One thread",
              desc: "We coordinate with sellers on your behalf, so you never chase multiple parties.",
            },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <span className="mt-0.5 shrink-0">{item.icon}</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8" aria-busy="true">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <Skeleton className="mt-6 h-[480px] w-full max-w-2xl rounded-xl" />
        </div>
      }
    >
      <SupportForm />
    </Suspense>
  );
}
