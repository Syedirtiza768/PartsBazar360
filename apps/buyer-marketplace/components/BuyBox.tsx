"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@repo/ui/button";
import { Badge } from "@repo/ui/badge";
import {
  CarIcon,
  ShieldCheckIcon,
  TruckIcon,
  RotateCcwIcon,
  MessageIcon,
  CopyIcon,
  CheckIcon,
  StoreIcon,
  MapPinIcon,
  ClockIcon,
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { useCart } from "@/lib/cart-context";
import { useGarage, vehicleShortLabel } from "@/lib/garage-context";
import { useToast } from "@/lib/toast-context";
import { fitmentForConfig, FITMENT_COPY } from "@/lib/fitment";
import { pushRecentlyViewed } from "@/lib/recent";
import { formatPrice, humanize, lowestOfferPrice, offerCurrency } from "@/lib/format";
import { FitmentBadge } from "./FitmentBadge";
import { ConditionBadge, SourceBadge } from "./ConditionBadge";
import type { Part, Offer } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Copyable part number chip                                           */
/* ------------------------------------------------------------------ */

function PartNumberChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard unavailable — chip still shows the number.
        }
      }}
      title="Copy part number"
      className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 transition-colors hover:border-slate-300 hover:bg-white"
    >
      <span className="part-number text-slate-800">{value}</span>
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600" />
      )}
      <span className="sr-only">{copied ? "Copied" : "Copy part number"}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Fitment checker — the buyer's vehicle vs this part                  */
/* ------------------------------------------------------------------ */

function FitmentChecker({ part }: { part: Part }) {
  const { activeVehicle, vehicles, ready, setActive } = useGarage();
  const [switching, setSwitching] = useState(false);

  if (!ready) {
    return <div className="h-20 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />;
  }

  if (!activeVehicle) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CarIcon className="h-4 w-4 text-slate-500" />
          Will this fit your car?
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Select your vehicle and we&apos;ll check this part against its compatibility evidence.
        </p>
        <Link
          href="/garage"
          className="mt-2.5 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          Select your vehicle →
        </Link>
      </div>
    );
  }

  const state = fitmentForConfig(part, activeVehicle.configId);
  const copy = FITMENT_COPY[state];
  const vehicleName = vehicleShortLabel(activeVehicle);

  const toneStyles: Record<string, string> = {
    verified: "border-emerald-200 bg-emerald-50",
    likely: "border-sky-200 bg-sky-50",
    check: "border-amber-200 bg-amber-50",
    incompatible: "border-red-200 bg-red-50",
    universal: "border-slate-200 bg-slate-50",
    unknown: "border-slate-200 bg-slate-50",
  };

  return (
    <div className={cn("rounded-xl border p-4", toneStyles[state])}>
      <div className="flex items-start justify-between gap-3">
        <FitmentBadge state={state} vehicleName={vehicleName} />
        <button
          type="button"
          onClick={() => setSwitching((v) => !v)}
          className="shrink-0 text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
        >
          {switching ? "Close" : "Change vehicle"}
        </button>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{copy.explainer}</p>

      {switching && (
        <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-white p-2">
          {vehicles.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setActive(v.id);
                setSwitching(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                v.id === activeVehicle.id
                  ? "bg-brand-50 font-semibold text-brand-700"
                  : "text-slate-700 hover:bg-slate-50",
              )}
            >
              <CarIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate">{vehicleShortLabel(v)}</span>
            </button>
          ))}
          <Link
            href="/garage"
            className="block rounded-md px-2.5 py-2 text-sm font-medium text-brand-600 hover:bg-slate-50"
          >
            + Add another vehicle
          </Link>
        </div>
      )}

      {(state === "check" || state === "unknown") && (
        <Link
          href={`/support?partId=${part.id}&subject=${encodeURIComponent(`Fitment check: ${part.title}`)}`}
          className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          <MessageIcon className="h-4 w-4" />
          Ask us to verify before you order
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Offer card                                                          */
/* ------------------------------------------------------------------ */

function OfferRow({
  offer,
  isBest,
  showBestLabel,
}: {
  offer: Offer;
  isBest: boolean;
  showBestLabel: boolean;
}) {
  const { addToCart, loading } = useCart();
  const { push } = useToast();
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  const profile = offer.seller?.profile;
  const sellerName = offer.seller?.name || offer.sellerName || "Marketplace seller";

  const handleAdd = async () => {
    setAdding(true);
    try {
      await addToCart(offer.id, 1);
      push({
        title: "Added to cart",
        description: sellerName ? `Sold by ${sellerName}` : undefined,
        tone: "success",
        action: { label: "View cart", onClick: () => router.push("/cart") },
      });
    } catch (err: unknown) {
      push({
        title: "Couldn't add to cart",
        description: err instanceof Error ? err.message : "Please try again.",
        tone: "error",
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        isBest ? "border-brand-200 bg-white shadow-card" : "border-slate-200 bg-white",
      )}
    >
      {showBestLabel && isBest && (
        <Badge tone="brand" size="sm" className="mb-2">
          Best price
        </Badge>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <StoreIcon className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{sellerName}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {/* condition is the field sellers actually set per offer;
                qualityTier has a schema default that can contradict it. */}
            <ConditionBadge qualityTier={offer.condition || offer.qualityTier} size="sm" />
            <SourceBadge partSource={offer.partSource} size="sm" />
          </div>
        </div>
        <p className="price shrink-0 text-xl">{formatPrice(offer.price, offer.currency)}</p>
      </div>

      {profile && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {profile.country && (
            <li className="flex items-center gap-1.5">
              <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              Ships from {profile.country}
            </li>
          )}
          {profile.fulfillmentSlaHours ? (
            <li className="flex items-center gap-1.5">
              <ClockIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              Dispatches within {Math.ceil(profile.fulfillmentSlaHours / 24)} business day
              {profile.fulfillmentSlaHours > 24 ? "s" : ""}
            </li>
          ) : null}
          <li className="flex items-center gap-1.5">
            <RotateCcwIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {profile.acceptsReturns
              ? `${profile.returnWindowDays ?? 30}-day returns`
              : "Returns not accepted"}
          </li>
          {profile.warrantyDays ? (
            <li className="flex items-center gap-1.5">
              <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              {profile.warrantyDays}-day seller warranty
            </li>
          ) : null}
        </ul>
      )}

      <Button
        fullWidth
        className="mt-3.5"
        onClick={handleAdd}
        loading={adding}
        disabled={loading && !adding}
      >
        Add to cart
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buy box                                                             */
/* ------------------------------------------------------------------ */

export function BuyBox({ part }: { part: Part }) {
  const offers = useMemo(() => [...(part.offers || [])].sort((a, b) => a.price - b.price), [part.offers]);
  const best = offers[0];

  // Record this visit for the recently-viewed rail.
  useEffect(() => {
    pushRecentlyViewed({
      id: part.id,
      title: part.title,
      image: part.imageUrls?.[0] ?? null,
      price: lowestOfferPrice(part.offers),
      currency: offerCurrency(part.offers),
    });
  }, [part]);

  return (
    <div className="space-y-4">
      {/* Title block */}
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ConditionBadge qualityTier={part.qualityTier || best?.condition || best?.qualityTier} />
          <SourceBadge partSource={part.partSource || best?.partSource} />
          {part.category && <Badge tone="neutral">{part.category}</Badge>}
        </div>
        <h1 className="mt-2.5 text-xl font-bold leading-snug tracking-tight text-slate-900 sm:text-2xl">
          {part.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          {part.brand && (
            <span>
              Brand: <span className="font-medium text-slate-700">{part.brand}</span>
            </span>
          )}
          {part.manufacturer && part.manufacturer !== part.brand && (
            <span>
              Manufacturer: <span className="font-medium text-slate-700">{part.manufacturer}</span>
            </span>
          )}
        </div>
      </div>

      {/* OE numbers */}
      {part.oeNumbers && part.oeNumbers.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            OE / part number{part.oeNumbers.length > 1 ? "s" : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {part.oeNumbers.map((num) => (
              <PartNumberChip key={num} value={num} />
            ))}
          </div>
        </div>
      )}

      {/* Fitment for the buyer's vehicle */}
      <FitmentChecker part={part} />

      {/* Offers */}
      {offers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center">
          <p className="text-sm font-semibold text-slate-700">Currently unavailable</p>
          <p className="mt-1 text-sm text-slate-500">
            No active offers for this part right now. Ask support to source it for you.
          </p>
          <Link
            href={`/support?partId=${part.id}&subject=${encodeURIComponent(`Sourcing request: ${part.title}`)}`}
            className="mt-3 inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Request this part →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.length > 1 && (
            <p className="text-sm font-semibold text-slate-900">
              {offers.length} offers from {formatPrice(best!.price, best!.currency)}
            </p>
          )}
          {offers.map((offer, i) => (
            <OfferRow key={offer.id} offer={offer} isBest={i === 0} showBestLabel={offers.length > 1} />
          ))}
        </div>
      )}

      {/* Trust rows */}
      <ul className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-[13px] text-slate-600">
        <li className="flex items-start gap-2.5">
          <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          Weight-based worldwide shipping, calculated per seller at checkout.
        </li>
        <li className="flex items-start gap-2.5">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          Fitment evidence and condition are disclosed on every listing — what you see is what
          arrives.
        </li>
        <li className="flex items-start gap-2.5">
          <MessageIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            Unsure about anything?{" "}
            <Link
              href={`/support?partId=${part.id}&subject=${encodeURIComponent(`Question: ${part.title}`)}`}
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              Ask before you buy.
            </Link>
          </span>
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sticky mobile action bar                                            */
/* ------------------------------------------------------------------ */

export function StickyMobileBar({ part }: { part: Part }) {
  const offers = useMemo(() => [...(part.offers || [])].sort((a, b) => a.price - b.price), [part.offers]);
  const best = offers[0];
  const { addToCart } = useCart();
  const { push } = useToast();
  const [adding, setAdding] = useState(false);

  if (!best) return null;

  const handleAdd = async () => {
    setAdding(true);
    try {
      await addToCart(best.id, 1);
      push({ title: "Added to cart", tone: "success" });
    } catch (err: unknown) {
      push({
        title: "Couldn't add to cart",
        description: err instanceof Error ? err.message : "Please try again.",
        tone: "error",
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-top-bar backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="price text-lg leading-tight">{formatPrice(best.price, best.currency)}</p>
          <p className="truncate text-xs text-slate-500">
            {humanize(best.condition || best.qualityTier)} ·{" "}
            {best.seller?.name || best.sellerName || "Marketplace seller"}
          </p>
        </div>
        <Button onClick={handleAdd} loading={adding} className="shrink-0">
          Add to cart
        </Button>
      </div>
    </div>
  );
}
