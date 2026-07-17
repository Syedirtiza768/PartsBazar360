"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@repo/ui/button";
import { Input, Checkbox } from "@repo/ui/field";
import { EmptyState } from "@repo/ui/empty-state";
import {
  CartIcon,
  CheckCircleIcon,
  StoreIcon,
  TruckIcon,
  ArrowLeftIcon,
  ShieldCheckIcon,
  CarIcon,
  ReceiptIcon,
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { useCart, type CartItem } from "@/lib/cart-context";
import { useGarage, vehicleFullLabel } from "@/lib/garage-context";
import { API_BASE_URL } from "@/lib/api";
import { formatPrice, humanize } from "@/lib/format";
import { CartLineFitment } from "@/components/CartLineFitment";
import { storeOrder } from "@/lib/order-history";

interface OrderResult {
  order: {
    id: string;
    status?: string;
    createdAt?: string;
    totalAmount: number;
    currency: string;
    sellerOrders: { id: string; subTotal: number; shippingTotal: number; status?: string }[];
  };
  paymentIntent: { status: string; provider: string };
}

type FormState = {
  name: string;
  email: string;
  line1: string;
  line2: string;
  city: string;
  country: string;
  postalCode: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  line1: "",
  line2: "",
  city: "",
  country: "",
  postalCode: "",
};

const REQUIRED: Array<keyof FormState> = ["name", "email", "line1", "city", "country"];

const LABELS: Record<keyof FormState, string> = {
  name: "Full name",
  email: "Email address",
  line1: "Address line 1",
  line2: "Address line 2",
  city: "City",
  country: "Country",
  postalCode: "Postal code",
};

function validate(form: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};
  for (const field of REQUIRED) {
    if (!form[field].trim()) errors[field] = `${LABELS[field]} is required.`;
  }
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Step indicator                                                      */
/* ------------------------------------------------------------------ */

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Details", "Review", "Done"];
  return (
    <ol className="flex items-center gap-2" aria-label="Checkout progress">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-slate-300 sm:w-10" aria-hidden="true" />}
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 text-sm font-medium",
                active ? "text-brand-700" : done ? "text-emerald-700" : "text-graphite-600",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold",
                  active
                    ? "border-brand-600 bg-brand-600 text-white"
                    : done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-400 bg-white text-graphite-600",
                )}
              >
                {done ? "✓" : n}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Order summary card (shared by both steps)                           */
/* ------------------------------------------------------------------ */

function SummaryCard({ items, subtotal, currency }: { items: CartItem[]; subtotal: number; currency: string | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <h2 className="text-base font-bold text-slate-900">Order summary</h2>
      <ul className="mt-3 space-y-2.5">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 text-sm">
            <span className="line-clamp-1 min-w-0 text-slate-600">
              {item.quantity}× {item.sellerOffer.canonicalPart?.title || "Part"}
            </span>
            <span className="price shrink-0 text-sm">
              {formatPrice(item.sellerOffer.price * item.quantity, item.sellerOffer.currency)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-graphite-600">Subtotal</dt>
          <dd className="price text-sm">{formatPrice(subtotal, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-graphite-600">Shipping</dt>
          <dd className="text-graphite-600">Per seller, added to total</dd>
        </div>
      </dl>
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-graphite-600">
        <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        Final weight-based shipping is calculated per seller shipment when the order is placed.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Checkout page                                                       */
/* ------------------------------------------------------------------ */

export default function CheckoutPage() {
  const { cart, subtotal, refresh } = useCart();
  const { activeVehicle, ready } = useGarage();

  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [confirmedFit, setConfirmedFit] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);

  const items = cart.items;
  const currency = items.find((i) => i.sellerOffer.currency)?.sellerOffer.currency ?? null;

  const sellerGroups = useMemo(() => {
    const groups = new Map<string, { name: string; items: CartItem[] }>();
    for (const item of items) {
      const key = item.sellerOffer.seller?.id || item.sellerOffer.seller?.name || "marketplace";
      const name = item.sellerOffer.seller?.name || "Marketplace seller";
      const group = groups.get(key) ?? { name, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [items]);

  const setField = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const goToReview = (e: FormEvent) => {
    e.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
      setStep(2);
      window.scrollTo({ top: 0 });
    }
  };

  const placeOrder = async () => {
    if (!cart.id) return;
    if (!confirmedFit) {
      setConfirmError(true);
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/checkout/${cart.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      if (!res.ok) throw new Error(data.message || "Checkout failed. Please try again.");
      setResult(data);
      storeOrder({
        id: data.order.id,
        createdAt: data.order.createdAt || new Date().toISOString(),
        status: data.order.status || "PENDING_PAYMENT",
        paymentStatus: data.paymentIntent.status,
        totalAmount: data.order.totalAmount,
        currency: data.order.currency,
        sellerOrders: data.order.sellerOrders,
        items,
        shippingAddress: {
          name: form.name,
          email: form.email,
          line1: form.line1,
          line2: form.line2 || undefined,
          city: form.city,
          country: form.country,
          postalCode: form.postalCode || undefined,
        },
        vehicle: activeVehicle,
      });
      await refresh();
      window.scrollTo({ top: 0 });
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : "Checkout failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- Confirmation ---------- */
  if (result) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        <div className="text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircleIcon className="h-8 w-8" />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Order confirmed
          </h1>
          <p className="mt-2 text-graphite-600">
            Thank you, {form.name.split(" ")[0] || "there"}. We&apos;ve sent a confirmation to{" "}
            <span className="font-medium text-slate-700">{form.email}</span>.
          </p>
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ReceiptIcon className="h-4 w-4 text-slate-400" />
              Order details
            </p>
          </div>
          <dl className="space-y-3 px-5 py-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-graphite-600">Order ID</dt>
              <dd className="part-number text-slate-900">{result.order.id}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-graphite-600">Seller shipments</dt>
              <dd className="font-medium text-slate-900">
                {result.order.sellerOrders.length} — each ships with its own tracking
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-graphite-600">Payment status</dt>
              <dd className="font-medium capitalize text-slate-900">
                {result.paymentIntent.status.toLowerCase().replace(/_/g, " ")}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-slate-100 pt-3 text-base">
              <dt className="font-semibold text-slate-900">Total (incl. shipping)</dt>
              <dd className="price">{formatPrice(result.order.totalAmount, result.order.currency)}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-900">What happens next</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Payment is confirmed and each seller is notified to pack your parts.</li>
            <li>Sellers add tracking numbers as shipments leave their warehouses.</li>
            <li>Questions or fitment concerns? Support can intervene at any point.</li>
          </ol>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/search" className={buttonClasses()}>
            Continue shopping
          </Link>
          <Link href={`/account/purchases/${encodeURIComponent(result.order.id)}`} className={buttonClasses({ variant: "outline" })}>
            View purchase
          </Link>
          <Link
            href={`/support?orderId=${encodeURIComponent(result.order.id)}&category=ORDER_ISSUE&subject=${encodeURIComponent(
              "Question about order " + result.order.id,
            )}`}
            className={buttonClasses({ variant: "outline" })}
          >
            Contact support
          </Link>
        </div>
      </div>
    );
  }

  /* ---------- Empty cart ---------- */
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          variant="page"
          icon={<CartIcon />}
          title="Nothing to check out"
          description="Your cart is empty. Add parts first, then come back here."
        >
          <Link href="/search" className={buttonClasses()}>
            Browse parts
          </Link>
        </EmptyState>
      </div>
    );
  }

  /* ---------- Steps 1 & 2 ---------- */
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Checkout</h1>
        <Steps current={step} />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_340px]">
        {step === 1 ? (
          <form onSubmit={goToReview} noValidate className="space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <h2 className="text-base font-semibold text-slate-900">Contact information</h2>
              <p className="mt-1 text-sm text-graphite-600">
                Order updates and tracking numbers go to this email. No account needed.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Full name"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={setField("name")}
                  error={errors.name}
                />
                <Input
                  label="Email address"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={setField("email")}
                  error={errors.email}
                />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <h2 className="text-base font-semibold text-slate-900">Shipping address</h2>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <Input
                  label="Address line 1"
                  autoComplete="address-line1"
                  required
                  value={form.line1}
                  onChange={setField("line1")}
                  error={errors.line1}
                />
                <Input
                  label="Address line 2"
                  autoComplete="address-line2"
                  hint="Apartment, suite, unit — optional"
                  value={form.line2}
                  onChange={setField("line2")}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input
                    label="City"
                    autoComplete="address-level2"
                    required
                    value={form.city}
                    onChange={setField("city")}
                    error={errors.city}
                  />
                  <Input
                    label="Postal code"
                    autoComplete="postal-code"
                    value={form.postalCode}
                    onChange={setField("postalCode")}
                  />
                  <Input
                    label="Country"
                    autoComplete="country-name"
                    required
                    value={form.country}
                    onChange={setField("country")}
                    error={errors.country}
                  />
                </div>
              </div>
            </section>

            <div className="flex items-center justify-between gap-3">
              <Link
                href="/cart"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-graphite-600 transition-colors hover:text-slate-700"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to cart
              </Link>
              <Button type="submit" size="lg">
                Review order
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            {/* Address recap */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Shipping to</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {form.name}
                    <br />
                    {form.line1}
                    {form.line2 ? <>, {form.line2}</> : null}
                    <br />
                    {[form.city, form.postalCode].filter(Boolean).join(" ")}, {form.country}
                    <br />
                    <span className="text-graphite-600">{form.email}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="shrink-0 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
                >
                  Edit
                </button>
              </div>
            </section>

            {/* Items by seller with fitment recap */}
            {sellerGroups.map((group) => (
              <section
                key={group.name}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
                aria-label={`Shipment from ${group.name}`}
              >
                <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
                    <StoreIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate">{group.name}</span>
                  </p>
                  <p className="flex shrink-0 items-center gap-1.5 text-xs text-graphite-600">
                    <TruckIcon className="h-3.5 w-3.5" />
                    Separate shipment
                  </p>
                </header>
                <ul className="divide-y divide-slate-100">
                  {group.items.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium text-slate-800">
                          {item.quantity}× {item.sellerOffer.canonicalPart?.title || "Part"}
                        </p>
                        <p className="mt-0.5 text-xs text-graphite-600">
                          {humanize(item.sellerOffer.condition || "USED")}
                        </p>
                        <div className="mt-1.5">
                          <CartLineFitment partId={item.sellerOffer.canonicalPart?.id} />
                        </div>
                      </div>
                      <span className="price shrink-0 text-sm">
                        {formatPrice(item.sellerOffer.price * item.quantity, item.sellerOffer.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {/* Compatibility confirmation */}
            <section
              className={cn(
                "rounded-xl border p-5 shadow-card",
                confirmError && !confirmedFit ? "border-red-300 bg-red-50" : "border-amber-200 bg-amber-50",
              )}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CarIcon className="h-4 w-4 text-amber-700" />
                Compatibility check
              </p>
              {ready && activeVehicle ? (
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  Your active vehicle is{" "}
                  <span className="font-semibold text-slate-900">{vehicleFullLabel(activeVehicle)}</span>.
                  Each line above shows its fitment status for this vehicle.
                </p>
              ) : (
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  No vehicle selected — we can&apos;t cross-check these parts for you. Match each
                  part&apos;s OE number against your vehicle before confirming.
                </p>
              )}
              <div className="mt-3">
                <Checkbox
                  checked={confirmedFit}
                  onChange={(e) => {
                    setConfirmedFit(e.target.checked);
                    if (e.target.checked) setConfirmError(false);
                  }}
                  label="I've confirmed these parts match my vehicle or intended use."
                  description="Used parts are specific to exact configurations — this check prevents most returns."
                />
                {confirmError && !confirmedFit && (
                  <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                    Please confirm compatibility before placing the order.
                  </p>
                )}
              </div>
            </section>

            {serverError && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                role="alert"
              >
                {serverError}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-graphite-600 transition-colors hover:text-slate-700"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to details
              </button>
              <Button size="lg" onClick={placeOrder} loading={submitting}>
                Place order — {formatPrice(subtotal, currency)} + shipping
              </Button>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-graphite-600">
              <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              Payment is captured securely after order placement; sellers only ship once payment is
              confirmed.
            </p>
          </div>
        )}

        <aside className="lg:sticky lg:top-40" aria-label="Order summary">
          <SummaryCard items={items} subtotal={subtotal} currency={currency} />
        </aside>
      </div>
    </div>
  );
}
