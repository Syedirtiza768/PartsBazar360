"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@repo/ui/button";
import { Input, Checkbox } from "@repo/ui/field";
import { EmptyState } from "@repo/ui/empty-state";
import {
  CartIcon,
  StoreIcon,
  TruckIcon,
  ArrowLeftIcon,
  ShieldCheckIcon,
  CarIcon,
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { useCart, type CartItem } from "@/lib/cart-context";
import { useGarage, vehicleFullLabel } from "@/lib/garage-context";
import { useAuth } from "@/lib/auth-context";
import { API_BASE_URL } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useCurrency } from "@/lib/currency-context";
import { SETTLEMENT_CURRENCY } from "@/lib/currency";
import { CartLineFitment } from "@/components/CartLineFitment";
import { storeOrder } from "@/lib/order-history";
import {
  getShippingCountry,
  setShippingCountry,
} from "@/lib/shipping-destination";
import {
  useShippingQuote,
  type ShippingQuote,
} from "@/lib/use-shipping-quote";

type FormState = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  country: string;
  postalCode: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  country: "",
  postalCode: "",
};

const REQUIRED: Array<keyof FormState> = ["name", "line1", "city", "country"];

const LABELS: Record<keyof FormState, string> = {
  name: "Full name",
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
  return errors;
}

function Steps({ current }: { current: 1 | 2 }) {
  const steps = ["Details", "Review"];
  return (
    <ol className="flex items-center gap-2" aria-label="Checkout progress">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2;
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

function SummaryCard({
  items,
  subtotal,
  currency,
  shippingQuote,
  shippingLoading,
  shippingError,
}: {
  items: CartItem[];
  subtotal: number;
  currency: string | null;
  shippingQuote: ShippingQuote | null;
  shippingLoading: boolean;
  shippingError?: string | null;
}) {
  const { format, currency: displayCurrency, settlementCurrency } = useCurrency();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <h2 className="text-base font-bold text-slate-900">Order summary</h2>
      <p className="mt-1 text-xs text-graphite-600">
        Charged in {displayCurrency} via Stripe. Merchant settlement is {settlementCurrency}.
      </p>
      <ul className="mt-3 space-y-2.5">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 text-sm">
            <span className="line-clamp-2 min-w-0 text-graphite-700">
              {item.quantity}× {item.sellerOffer.canonicalPart?.title || "Part"}
            </span>
            <span className="price shrink-0 text-sm">
              {format(item.sellerOffer.price * item.quantity, item.sellerOffer.currency)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-graphite-600">Subtotal</dt>
          <dd className="price text-sm">{format(subtotal, currency)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-graphite-600">Shipping</dt>
          <dd className="text-right text-graphite-600">
            {shippingLoading
              ? "Calculating…"
              : shippingQuote
                ? format(shippingQuote.shippingTotal, shippingQuote.currency || SETTLEMENT_CURRENCY)
                : "Enter country to estimate"}
          </dd>
        </div>
        {shippingQuote && (
          <div className="flex justify-between gap-3 border-t border-slate-100 pt-2">
            <dt className="font-semibold text-slate-900">Estimated total</dt>
            <dd className="price text-sm">
              {format(shippingQuote.totalAmount, shippingQuote.currency || SETTLEMENT_CURRENCY)}
            </dd>
          </div>
        )}
      </dl>
      {shippingError && !shippingQuote && (
        <p className="mt-2 text-xs text-amber-700" role="status">
          {shippingError}
        </p>
      )}
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-graphite-600">
        <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        Shipping is calculated in AED, then converted into your selected charge currency.
      </p>
    </div>
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, subtotal, refresh } = useCart();
  const { activeVehicle, ready: garageReady } = useGarage();
  const { user, ready: authReady, isAuthenticated, authHeaders } = useAuth();
  const { format, currency: displayCurrency, settlementCurrency } = useCurrency();

  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [confirmedFit, setConfirmedFit] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const items = cart.items;
  const currency = items.find((i) => i.sellerOffer.currency)?.sellerOffer.currency ?? null;

  const {
    quote: shippingQuote,
    loading: shippingLoading,
    error: shippingError,
  } = useShippingQuote({
    cartId: cart.id,
    country: form.country,
    currency: displayCurrency,
    enabled: isAuthenticated,
    authHeaders,
  });

  // Shipments over the courier ceiling are rejected by processCheckout, so the
  // Pay button must be disabled rather than failing after the buyer commits.
  const freightSellers = (shippingQuote?.sellerQuotes ?? []).filter(
    (quote) => quote.requiresFreightQuote,
  );

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent("/checkout")}`);
    }
  }, [authReady, isAuthenticated, router]);

  useEffect(() => {
    if (prefilled || !authReady) return;
    const savedCountry = getShippingCountry();
    setForm((prev) => ({
      ...prev,
      name: prev.name || user?.name || "",
      country: prev.country || savedCountry,
    }));
    setPrefilled(true);
  }, [user, prefilled, authReady]);

  useEffect(() => {
    if (form.country.trim()) setShippingCountry(form.country);
  }, [form.country]);

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
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          name: form.name,
          chargeCurrency: displayCurrency,
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

      storeOrder({
        id: data.order.id,
        createdAt: data.order.createdAt || new Date().toISOString(),
        status: data.order.status || "PENDING_PAYMENT",
        paymentStatus: data.paymentIntent?.status || "PENDING",
        totalAmount: data.order.totalAmount,
        currency: data.order.currency,
        sellerOrders: data.order.sellerOrders,
        items,
        shippingAddress: {
          name: form.name,
          email: user?.email || "",
          line1: form.line1,
          line2: form.line2 || undefined,
          city: form.city,
          country: form.country,
          postalCode: form.postalCode || undefined,
        },
        vehicle: activeVehicle,
      });
      await refresh();

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      throw new Error("Stripe Checkout URL missing. Check sandbox configuration.");
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : "Checkout failed. Please try again.");
      setSubmitting(false);
    }
  };

  if (!authReady || !isAuthenticated) {
    return (
      <div className="mx-auto max-w-md gutter py-16 text-center text-sm text-graphite-600">
        Checking your account…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl gutter py-16">
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

  return (
    <div className="mx-auto max-w-content gutter py-8 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Checkout</h1>
        <Steps current={step} />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_340px]">
        {step === 1 ? (
          <form onSubmit={goToReview} noValidate className="space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
              <h2 className="text-base font-semibold text-slate-900">Account</h2>
              <p className="mt-1 text-sm text-graphite-600">
                Signed in as <span className="font-medium text-slate-800">{user?.email}</span>. Payment
                continues on Stripe — we never see your card details.
              </p>
              <div className="mt-4">
                <Input
                  label="Full name"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={setField("name")}
                  error={errors.name}
                />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
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

            {/*
              Reverse-stacked on phones: the forward action sits above the
              back link so the thumb lands on "Review order", and both keep a
              full 44px target instead of sharing one cramped row.
            */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href="/cart"
                className="inline-flex min-h-touch items-center justify-center gap-1.5 text-sm font-medium text-graphite-600 transition-colors hover:text-graphite-800 sm:justify-start"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to cart
              </Link>
              <Button type="submit" size="lg" fullWidth className="sm:w-auto">
                Review order
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
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
                    <span className="text-graphite-600">{user?.email}</span>
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

            {sellerGroups.map((group) => (
              <section
                key={group.name}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
                aria-label={`Shipment from ${group.name}`}
              >
                <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
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
                    <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3.5 sm:gap-4 sm:px-5">
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
                        {format(item.sellerOffer.price * item.quantity, item.sellerOffer.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

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
              {garageReady && activeVehicle ? (
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

            {shippingError && step === 2 && (
              <div
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                role="status"
              >
                {shippingError}
              </div>
            )}

            {shippingQuote && step === 2 && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
                <h2 className="text-base font-semibold text-slate-900">Shipping estimate</h2>
                <p className="mt-1 text-sm text-graphite-600">
                  Estimated for {shippingQuote.destinationCountry}, split per seller shipment.
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  {shippingQuote.sellerQuotes.map((quote) => (
                    <li key={quote.sellerId} className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-graphite-700">
                        {quote.sellerName}
                        {!quote.matchedCountry ? " (average fallback rate)" : ""}
                      </span>
                      <span className="price shrink-0">
                        {quote.requiresFreightQuote
                          ? "Freight quote"
                          : format(quote.amount, shippingQuote.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                {freightSellers.length > 0 && (
                  /* Checkout rejects these server-side, so warn here rather than
                     letting the buyer discover it on the Pay button. */
                  <div
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                    role="status"
                  >
                    <p className="font-semibold">This order needs a freight quote</p>
                    <p className="mt-1">
                      {freightSellers.length === 1
                        ? `${freightSellers[0]!.sellerName}'s shipment exceeds courier limits`
                        : `${freightSellers.length} shipments exceed courier limits`}
                      , so we price them manually instead of charging an automatic
                      rate.{" "}
                      <Link
                        href={`/support?subject=${encodeURIComponent("Freight quote request")}`}
                        className="font-semibold underline underline-offset-2"
                      >
                        Request a freight quote
                      </Link>{" "}
                      and we&apos;ll come back with a price.
                    </p>
                  </div>
                )}
              </section>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex min-h-touch items-center justify-center gap-1.5 text-sm font-medium text-graphite-600 transition-colors hover:text-graphite-800 sm:justify-start"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to details
              </button>
              <Button
                size="lg"
                onClick={placeOrder}
                loading={submitting}
                disabled={freightSellers.length > 0}
                fullWidth
                className="sm:w-auto"
              >
                {/* The full label runs to three lines in a 288px button, so
                    phones get the amount and desktops get the full sentence. */}
                <span className="sm:hidden">
                  Pay {format(shippingQuote?.totalAmount ?? subtotal, shippingQuote?.currency ?? currency)}
                </span>
                <span className="hidden sm:inline">
                  Pay with Stripe —{" "}
                  {format(shippingQuote?.totalAmount ?? subtotal, shippingQuote?.currency ?? currency)}
                </span>
              </Button>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-graphite-600">
              <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              You&apos;ll be redirected to Stripe Checkout and pay in {displayCurrency}. Card details
              stay with Stripe; PartsBazar360 settles in {settlementCurrency}.
            </p>
          </div>
        )}

        <aside className="lg:sticky lg:top-28" aria-label="Order summary">
          <SummaryCard
            items={items}
            subtotal={subtotal}
            currency={currency}
            shippingQuote={shippingQuote}
            shippingLoading={shippingLoading}
            shippingError={shippingError}
          />
        </aside>
      </div>
    </div>
  );
}
