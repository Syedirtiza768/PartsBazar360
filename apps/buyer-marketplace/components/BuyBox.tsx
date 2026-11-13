"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@repo/ui/button";
import { Badge } from "@repo/ui/badge";
import {
  CarIcon,
  ShieldCheckIcon,
  MessageIcon,
  CopyIcon,
  CheckIcon,
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { useCart } from "@/lib/cart-context";
import { useGarage, vehicleShortLabel } from "@/lib/garage-context";
import { useToast } from "@/lib/toast-context";
import { useCurrency } from "@/lib/currency-context";
import { FITMENT_COPY, type FitmentState } from "@/lib/fitment";
import { pushRecentlyViewed } from "@/lib/recent";
import {
  humanize,
  lowestOfferPrice,
  offerCurrency,
  buyerVisibleOffers,
} from "@/lib/format";
import { partTypeFromLegacy } from "@repo/catalog-contracts";
import type { PartShippingQuote } from "@/lib/use-part-shipping-quote";
import type { PurchaseActionPolicy } from "@/lib/purchase-action-policy";
import { FitmentBadge } from "./FitmentBadge";
import { ConditionBadge, SourceBadge } from "./ConditionBadge";
import { WatchlistButton } from "./WatchlistButton";
import { ShippingDestinationPicker } from "./ShippingDestinationPicker";
import { PaymentBadgeRow } from "./PaymentBadgeRow";
import type { Part, Offer } from "@/lib/types";
import { usePdpPurchaseState } from "./PdpPurchaseContext";

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
      className="group inline-flex min-h-touch items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 transition-colors hover:border-slate-300 hover:bg-white sm:min-h-0"
    >
      <span className="part-number break-anywhere text-left text-slate-800">
        {value}
      </span>
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

function FitmentChecker({
  part,
  state,
}: {
  part: Part;
  state: FitmentState | null;
}) {
  const { activeVehicle, vehicles, ready, setActive } = useGarage();
  const [switching, setSwitching] = useState(false);
  const currentState = state ?? "unknown";

  if (!ready) {
    return (
      <div
        className="h-20 animate-pulse rounded-xl bg-slate-100"
        aria-hidden="true"
      />
    );
  }

  if (!activeVehicle) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CarIcon className="h-4 w-4 text-graphite-600" />
          Will this fit your car?
        </p>
        <p className="mt-1 text-sm text-graphite-600">
          Select your vehicle and we&apos;ll check this part against its
          compatibility evidence.
        </p>
        <Link
          href="/garage"
          className="mt-1.5 inline-flex min-h-touch items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          Select your vehicle →
        </Link>
      </div>
    );
  }

  const copy = FITMENT_COPY[currentState];
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
    <div className={cn("rounded-xl border p-4", toneStyles[currentState])}>
      <div className="flex items-start justify-between gap-3">
        {state === null ? (
          <p role="status" className="text-sm font-medium text-graphite-700">
            Checking compatibility for your {vehicleName}…
          </p>
        ) : (
          <FitmentBadge state={currentState} vehicleName={vehicleName} />
        )}
        <button
          type="button"
          onClick={() => setSwitching((v) => !v)}
          className="-my-1.5 shrink-0 px-1 py-1.5 text-xs font-semibold text-graphite-600 underline-offset-2 hover:text-graphite-800 hover:underline touch-halo"
        >
          {switching ? "Close" : "Change vehicle"}
        </button>
      </div>
      {state !== null && (
        <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
          {copy.explainer}
        </p>
      )}

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
            className="flex min-h-touch items-center rounded-md px-2.5 py-2 text-sm font-medium text-brand-600 hover:bg-slate-50"
          >
            + Add another vehicle
          </Link>
        </div>
      )}

      {state !== null &&
        (currentState === "check" || currentState === "unknown") && (
          <Link
            href={`/support?partId=${part.id}&subject=${encodeURIComponent(`Fitment check: ${part.title}`)}`}
            className="mt-1.5 inline-flex min-h-touch items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
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
  part,
  isBest,
  showBestLabel,
  destination,
  requiresFreightQuote,
  shippingQuote,
  shippingLoading,
  intendedVehicleConfigId,
  actionPolicy,
}: {
  offer: Offer;
  part: Part;
  isBest: boolean;
  showBestLabel: boolean;
  destination: string;
  requiresFreightQuote: boolean;
  shippingQuote: PartShippingQuote | null;
  shippingLoading: boolean;
  intendedVehicleConfigId: string | null;
  actionPolicy: PurchaseActionPolicy;
}) {
  const { addToCart, loading } = useCart();
  const { push } = useToast();
  const { format } = useCurrency();
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    try {
      await addToCart(offer.id, 1, intendedVehicleConfigId);
      push({
        title: "Added to cart",
        description: "You can review shipment details in your cart.",
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

  const handleBuyNow = async () => {
    setAdding(true);
    try {
      await addToCart(offer.id, 1, intendedVehicleConfigId);
      router.push("/checkout");
    } catch (err: unknown) {
      push({
        title: "Couldn't start checkout",
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
        isBest
          ? "border-brand-200 bg-white shadow-card"
          : "border-slate-200 bg-white",
      )}
    >
      {showBestLabel && isBest && (
        <Badge tone="brand" size="sm" className="mb-2">
          Best price
        </Badge>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5"></div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {/* condition is the field sellers actually set per offer;
                qualityTier has a schema default that can contradict it. */}
            <ConditionBadge
              qualityTier={offer.condition || offer.qualityTier}
              partSource={offer.partSource}
              partType={offer.partType || part.partType}
              size="sm"
            />
            <SourceBadge
              partSource={offer.partSource}
              partType={offer.partType || part.partType}
              size="sm"
            />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="price text-lg sm:text-xl">
            {format(offer.price, offer.currency)}
          </p>
          {requiresFreightQuote ? (
            <p className="mt-0.5 text-xs font-medium text-amber-600">
              + freight quote
            </p>
          ) : !destination ? null : shippingLoading && !shippingQuote ? (
            <p className="mt-0.5 text-xs text-graphite-500">+ shipping…</p>
          ) : shippingQuote?.available && shippingQuote.amount != null ? (
            <p className="mt-0.5 text-xs text-graphite-600">
              +{" "}
              <span className="price text-xs">
                {format(shippingQuote.amount, shippingQuote.currency)}
              </span>{" "}
              shipping
              {shippingQuote.leadTime ? ` · ${shippingQuote.leadTime}` : ""}
            </p>
          ) : shippingQuote ? (
            <p className="mt-0.5 text-xs font-medium text-amber-700">
              {shippingQuote.requiresFreightQuote
                ? "Freight quote required"
                : shippingQuote.availabilityReason === "SPECIAL_HANDLING_REVIEW"
                  ? "Specialist shipping review required"
                  : "Delivery unavailable"}
            </p>
          ) : null}
        </div>
      </div>

      {actionPolicy.canPurchase ? (
        <div className="mt-3.5 grid grid-cols-1 gap-2 xs:grid-cols-2">
          <Button
            variant="outline"
            fullWidth
            onClick={handleAdd}
            loading={adding}
            disabled={loading && !adding}
          >
            {actionPolicy.addLabel}
          </Button>
          {actionPolicy.buyHref ? (
            <Link
              href={actionPolicy.buyHref}
              className="inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-800"
            >
              {actionPolicy.buyLabel}
            </Link>
          ) : (
            <Button
              fullWidth
              onClick={handleBuyNow}
              disabled={loading || adding}
            >
              {actionPolicy.buyLabel}
            </Button>
          )}
        </div>
      ) : actionPolicy.blockedHref ? (
        <Link
          href={actionPolicy.blockedHref}
          className="mt-3.5 flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-800"
        >
          {actionPolicy.blockedLabel}
        </Link>
      ) : (
        <div
          className="mt-3.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-center text-sm font-medium text-amber-900"
          role="status"
        >
          {actionPolicy.blockedLabel || actionPolicy.addLabel}
        </div>
      )}
      <Link
        href={`/support?partId=${part.id}&category=GENERAL&subject=${encodeURIComponent(`Question about ${part.title}`)}`}
        className="mt-3 flex min-h-touch items-center justify-center gap-2 border border-stone-300 text-sm font-semibold text-graphite-700 hover:border-slate-500 hover:text-graphite-950"
      >
        <MessageIcon className="h-4 w-4" /> Ask about this part
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buy box                                                             */
/* ------------------------------------------------------------------ */

export function BuyBox({ part, heading }: { part: Part; heading?: string }) {
  const offers = useMemo(() => buyerVisibleOffers(part.offers), [part.offers]);
  const best = offers[0];
  const { format } = useCurrency();
  const {
    activeVehicleConfigId,
    fitmentState,
    destination,
    setDestination,
    shippingQuote,
    shippingLoading,
    shippingError,
    shippingStatus,
    actionPolicy,
  } = usePdpPurchaseState();
  const partType = partTypeFromLegacy(
    part.partSource || best?.partSource,
    part.partType || best?.partType,
  );
  const identityLabel =
    partType === "AFTERMARKET"
      ? "Aftermarket brand"
      : partType === "SALVAGE_OEM"
        ? "Original make"
        : partType === "GENUINE_OEM"
          ? "Genuine vehicle make"
          : "Brand";

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

  const requiresFreightQuote = shippingStatus === "FREIGHT_QUOTE";

  return (
    <div className="space-y-4">
      {/* Title block */}
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ConditionBadge
            qualityTier={
              best?.condition || part.qualityTier || best?.qualityTier
            }
            partSource={part.partSource || best?.partSource}
            partType={part.partType || best?.partType}
          />
          <SourceBadge
            partSource={part.partSource || best?.partSource}
            partType={part.partType || best?.partType}
          />
          {part.category && <Badge tone="neutral">{part.category}</Badge>}
        </div>
        <h1 className="mt-2.5 text-balance text-xl font-bold leading-snug tracking-tight text-slate-900 sm:text-2xl">
          {heading || part.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-graphite-600">
          {part.brand && (
            <span>
              {identityLabel}:{" "}
              <Link
                href={`/search?brand=${encodeURIComponent(part.brand)}`}
                className="font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                {part.brand}
              </Link>
            </span>
          )}
          {part.manufacturer && part.manufacturer !== part.brand && (
            <span>
              Manufacturer:{" "}
              <span className="font-medium text-slate-700">
                {part.manufacturer}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* OE numbers */}
      {(part.manufacturerPartNumber ||
        (part.oeNumbers && part.oeNumbers.length > 0)) && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-graphite-600">
            {partType === "AFTERMARKET"
              ? "Brand part number"
              : "OEM part number"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(part.manufacturerPartNumber
              ? [part.manufacturerPartNumber]
              : part.oeNumbers || []
            ).map((num) => (
              <PartNumberChip key={num} value={num} />
            ))}
          </div>
        </div>
      )}

      {/* Fitment for the buyer's vehicle */}
      <FitmentChecker part={part} state={fitmentState} />

      <WatchlistButton part={part} className="w-full" />

      {/* Offers */}
      {offers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center">
          <p className="text-sm font-semibold text-slate-700">
            Currently unavailable
          </p>
          <p className="mt-1 text-sm text-graphite-600">
            No active offers for this part right now. Ask support to source it
            for you.
          </p>
          <Link
            href={`/support?partId=${part.id}&subject=${encodeURIComponent(`Sourcing request: ${part.title}`)}`}
            className="mt-2 inline-flex min-h-touch items-center text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Request this part →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.length > 1 && (
            <p className="text-sm font-semibold text-slate-900">
              {offers.length} offers from {format(best!.price, best!.currency)}
            </p>
          )}
          <ShippingDestinationPicker
            part={part}
            shipping={part.shipping}
            destination={destination}
            onDestinationChange={setDestination}
          />
          {offers.map((offer, i) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              part={part}
              isBest={i === 0}
              showBestLabel={offers.length > 1}
              destination={destination}
              requiresFreightQuote={requiresFreightQuote}
              shippingQuote={shippingQuote}
              shippingLoading={shippingLoading}
              intendedVehicleConfigId={activeVehicleConfigId}
              actionPolicy={actionPolicy}
            />
          ))}
          {shippingError && (
            <p className="text-xs text-amber-800" role="status">
              {shippingError}
            </p>
          )}
        </div>
      )}

      <PaymentBadgeRow destinationCountry={destination} />

      {/* Trust rows */}
      <ul className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-[13px] text-slate-600">
        <li className="flex items-start gap-2.5">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          Fitment evidence and condition are disclosed on every listing — what
          you see is what arrives.
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
  const offers = useMemo(() => buyerVisibleOffers(part.offers), [part.offers]);
  const best = offers[0];
  const { addToCart } = useCart();
  const { push } = useToast();
  const { format } = useCurrency();
  const {
    activeVehicleConfigId,
    destination,
    shippingQuote,
    shippingStatus,
    actionPolicy,
  } = usePdpPurchaseState();
  const [adding, setAdding] = useState(false);

  if (!best) return null;

  const handleAdd = async () => {
    setAdding(true);
    try {
      await addToCart(best.id, 1, activeVehicleConfigId);
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
    /* pb-safe-b-3 rather than a flat py-3: on a notched iPhone the bar sat
       under the home indicator and "Add to cart" was only half tappable. */
    <div className="fixed inset-x-0 bottom-0 z-sticky border-t border-slate-200 bg-white/95 gutter pb-safe-b-3 pt-3 shadow-top-bar backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="price text-lg leading-tight">
            {format(best.price, best.currency)}
          </p>
          <p className="truncate text-xs text-graphite-600">
            {(() => {
              const cond = humanize(best.condition || best.qualityTier);
              return cond;
            })()}
          </p>
          <p className="truncate text-[11px] text-graphite-600">
            {shippingStatus === "AVAILABLE" && shippingQuote?.amount != null
              ? `${destination}: ${format(shippingQuote.amount, shippingQuote.currency)} shipping`
              : actionPolicy.blockedLabel || actionPolicy.addLabel}
          </p>
        </div>
        {actionPolicy.canPurchase && actionPolicy.buyHref ? (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <Link
              href={actionPolicy.buyHref}
              className="inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-3 py-2 text-center text-xs font-semibold text-white"
            >
              {actionPolicy.buyLabel}
            </Link>
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding}
              className="min-h-9 px-1 text-xs font-medium leading-tight text-brand-700 underline underline-offset-2 disabled:opacity-60"
            >
              {adding ? "Adding…" : actionPolicy.addLabel}
            </button>
          </div>
        ) : actionPolicy.canPurchase ? (
          <Button onClick={handleAdd} loading={adding} className="shrink-0">
            {actionPolicy.addLabel}
          </Button>
        ) : actionPolicy.blockedHref ? (
          <Link
            href={actionPolicy.blockedHref}
            className="inline-flex min-h-touch shrink-0 items-center justify-center rounded-lg bg-brand-700 px-3 py-2 text-center text-xs font-semibold text-white"
          >
            {actionPolicy.blockedLabel}
          </Link>
        ) : (
          <Button disabled className="shrink-0">
            {actionPolicy.blockedLabel || actionPolicy.addLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
