"use client";

import Link from "next/link";
import { Skeleton } from "@repo/ui/skeleton";
import { UserIcon, TagIcon, RefreshIcon } from "@repo/ui/icons";
import { PartImage } from "./PartImage";
import { FitmentBadge } from "./FitmentBadge";
import { ConditionBadge, SourceBadge } from "./ConditionBadge";
import { Price } from "./Price";
import { WatchlistButton } from "./WatchlistButton";
import { lowestOfferPrice, offerCurrency, buyerVisibleOffers } from "@/lib/format";
import { fitmentForConfig } from "@/lib/fitment";
import { useGarage, vehicleShortLabel } from "@/lib/garage-context";
import type { Part } from "@/lib/types";

/**
 * Marketplace product card. Shows, in priority order: image, fitment status
 * for the active vehicle, condition + source, title, OE number, seller,
 * price. Fitment badge only renders once the garage has loaded to avoid a
 * badge flash-swap.
 */
export function ProductCard({
  part,
  fitmentContext = "auto",
}: {
  part: Part;
  /**
   * "auto": evaluate against the active vehicle (default) ·
   * "verified": results already filtered to verified fitment (vehicle search) ·
   * "hidden": never show a fitment badge (e.g. recently viewed rail).
   */
  fitmentContext?: "auto" | "verified" | "hidden";
}) {
  const { activeVehicle, ready } = useGarage();

  const offers = buyerVisibleOffers(part.offers);
  const price = lowestOfferPrice(offers);
  const currency = offerCurrency(offers);
  const offerCount = offers.length;
  const image = part.imageUrls?.[0];
  const bestOffer = offers[0];
  const sellerName =
    bestOffer?.seller?.name || bestOffer?.sellerName || null;
  const oeNumber = part.oeNumbers?.[0] || null;
  // Older index documents carry tier/source only on the offer — fall back
  // through the chain rather than hiding it. Offer condition outranks the
  // offer's qualityTier, which has a schema default that can contradict it.
  const qualityTier =
    part.qualityTier || bestOffer?.condition || bestOffer?.qualityTier;
  const partSource = part.partSource || bestOffer?.partSource;
  const partType = part.partType || bestOffer?.partType || (partSource === "AFTERMARKET" ? "AFTERMARKET" : "GENUINE_OEM");
  const isAftermarket = partType === "AFTERMARKET";
  const isSalvage = partType === "SALVAGE_OEM";
  const referenceMakes = [...new Set((part.oemCrossReferences || []).map((reference) => reference.make).filter(Boolean))];
  const identityNumber = part.manufacturerPartNumber || oeNumber;

  if (offerCount === 0) return null;

  const vehicleName = activeVehicle ? vehicleShortLabel(activeVehicle) : null;
  const fitment =
    fitmentContext === "hidden"
      ? null
      : fitmentContext === "verified"
        ? "verified"
        : ready && activeVehicle
          ? fitmentForConfig(part, activeVehicle.configId)
          : null;

  return (
    <article className="group relative flex flex-col overflow-hidden bg-white transition-all duration-150 hover:z-10 hover:shadow-card-hover">
      <div className="relative aspect-square overflow-hidden border-b border-stone-200 bg-[#f7f6f2]">
        <Link href={`/part/${part.id}`} className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500">
        <PartImage
          src={image}
          alt={part.title}
          className="object-contain p-4 transition-transform duration-300 group-hover:scale-[1.035]"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        />
        <span className="sr-only">View {part.title}</span>
        </Link>
        {offerCount > 1 && (
          <span className="absolute left-0 top-0 border-b border-r border-stone-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-700">
            {offerCount} offers
          </span>
        )}
        <WatchlistButton part={part} compact className="absolute right-2 top-2 z-10 bg-white/95" />
      </div>

      <div className="flex flex-1 flex-col p-4">
        {/* Fitment for the buyer's vehicle — most important signal. */}
        {fitment && (
          <div className="mb-2">
            <FitmentBadge
              state={fitment}
              size="sm"
              vehicleName={fitment === "verified" ? vehicleName : null}
            />
          </div>
        )}

        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <ConditionBadge qualityTier={qualityTier} size="sm" />
          <SourceBadge partSource={partSource} partType={partType} size="sm" />
        </div>

        {/* Found via a cross-reference number, not this part's own — say so,
            so the buyer trusts why a "different" number surfaced this part. */}
        {part.matchedVia === "interchange" && (
          <p className="mb-1.5 flex items-start gap-1 text-[11px] font-medium leading-tight text-sky-800">
            <RefreshIcon className="mt-0.5 h-3 w-3 shrink-0 text-sky-600" />
            <span>
              Interchange match{part.matchedNumber ? (
                <>
                  {" "}for <span className="part-number">{part.matchedNumber}</span>
                </>
              ) : null}
            </span>
          </p>
        )}

        <h3 className="min-h-10 text-sm font-semibold leading-snug text-slate-800 group-hover:text-brand-800">
          <Link href={`/part/${part.id}`} className="line-clamp-2 focus-visible:outline-none focus-visible:underline">{part.title}</Link>
        </h3>

        <div className="mt-1.5 flex-1 space-y-1">
          {part.brand && (
            <p className="text-xs text-graphite-600">
              {isAftermarket ? "Brand" : isSalvage ? "Original make" : "Genuine make"}: <span className="font-semibold text-slate-700">{part.brand}</span>
            </p>
          )}
          {identityNumber && (
            <p className="flex items-center gap-1 text-xs text-graphite-600">
              <TagIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="shrink-0">{isAftermarket ? "Brand part no." : "OEM no."}</span>
              <span className="part-number truncate">{identityNumber}</span>
            </p>
          )}
          {isAftermarket && referenceMakes.length > 0 && (
            <p className="truncate text-xs text-graphite-600">Replaces OEM numbers for: {referenceMakes.join(", ")}</p>
          )}
          {sellerName && (
            <p className="flex items-center gap-1 text-xs text-graphite-600">
              <UserIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{sellerName}</span>
            </p>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-stone-200 pt-3">
          <Price amount={price} currency={currency} from={offerCount > 1} />
          <Link href={`/part/${part.id}`} className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-700 hover:text-brand-900">View listing</Link>
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden border border-stone-200 bg-white shadow-card">
      <Skeleton className="aspect-square rounded-none" />
      <div className="space-y-2.5 p-3.5">
        <Skeleton className="h-4 w-20 rounded-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
        <div className="border-t border-slate-100 pt-2.5">
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
    </div>
  );
}
