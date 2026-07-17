"use client";

import Link from "next/link";
import { Skeleton } from "@repo/ui/skeleton";
import { UserIcon, TagIcon } from "@repo/ui/icons";
import { PartImage } from "./PartImage";
import { FitmentBadge } from "./FitmentBadge";
import { ConditionBadge, SourceBadge } from "./ConditionBadge";
import { Price } from "./Price";
import { lowestOfferPrice, offerCurrency } from "@/lib/format";
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

  const price = lowestOfferPrice(part.offers);
  const currency = offerCurrency(part.offers);
  const offerCount = part.offers?.length || 0;
  const image = part.imageUrls?.[0];
  const sellerName =
    part.offers?.[0]?.seller?.name || part.offers?.[0]?.sellerName || null;
  const oeNumber = part.oeNumbers?.[0] || null;
  // Older index documents carry tier/source only on the offer — fall back
  // through the chain rather than hiding it. Offer condition outranks the
  // offer's qualityTier, which has a schema default that can contradict it.
  const qualityTier =
    part.qualityTier || part.offers?.[0]?.condition || part.offers?.[0]?.qualityTier;
  const partSource = part.partSource || part.offers?.[0]?.partSource;

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
    <Link
      href={`/part/${part.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
    >
      <div className="relative aspect-square overflow-hidden border-b border-slate-100 bg-slate-50">
        <PartImage
          src={image}
          alt={part.title}
          className="object-contain p-3 transition-transform duration-300 group-hover:scale-[1.04]"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        />
        {offerCount > 1 && (
          <span className="absolute right-2 top-2 rounded-full border border-slate-200 bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm">
            {offerCount} offers
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5">
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
          <SourceBadge partSource={partSource} size="sm" />
        </div>

        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-slate-800 group-hover:text-slate-950">
          {part.title}
        </h3>

        <div className="mt-1.5 flex-1 space-y-1">
          {oeNumber && (
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <TagIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="part-number truncate">{oeNumber}</span>
            </p>
          )}
          {sellerName && (
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <UserIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{sellerName}</span>
            </p>
          )}
        </div>

        <div className="mt-2.5 border-t border-slate-100 pt-2.5">
          <Price amount={price} currency={currency} from={offerCount > 1} />
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
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
