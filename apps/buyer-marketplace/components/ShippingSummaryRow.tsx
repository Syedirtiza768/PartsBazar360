import Link from "next/link";
import { TruckIcon } from "@repo/ui/icons";
import type { Part, PartShipping } from "@/lib/types";

/** Trims trailing zeros so 1.60 reads as "1.6 kg" and 4.00 as "4 kg". */
function formatKg(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}`.replace(/\.0+$/, "");
}

/**
 * Shows the resolved shipping weight on first paint.
 *
 * Buyers convert better on an approximate figure shown instantly than on an
 * exact one that arrives seconds later, so this never blocks: the server always
 * sends a usable estimate and this row simply discloses how firm it is.
 */
export function ShippingSummaryRow({
  part,
  shipping,
}: {
  part: Part;
  shipping?: PartShipping | null;
}) {
  if (!shipping) {
    return (
      <li className="flex items-start gap-2.5">
        <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        Weight-based worldwide shipping, calculated per seller at checkout.
      </li>
    );
  }

  if (shipping.requiresFreightQuote) {
    return (
      <li className="flex items-start gap-2.5">
        <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>
          <span className="font-semibold text-slate-800">
            Oversized item ({formatKg(shipping.billableWeightKg)} kg billable)
          </span>{" "}
          — this ships as freight rather than courier, so we quote it manually.{" "}
          <Link
            href={`/support?partId=${part.id}&subject=${encodeURIComponent(
              `Freight quote request: ${part.title}`,
            )}`}
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            Request a freight quote
          </Link>
          .
        </span>
      </li>
    );
  }

  const volumetric = shipping.weightBasis === "VOLUMETRIC";
  const firm = shipping.state === "exact";

  return (
    <li className="flex items-start gap-2.5">
      <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <span>
        Ships at{" "}
        <span className="font-semibold text-slate-800">
          {formatKg(shipping.billableWeightKg)} kg
        </span>{" "}
        billable weight
        {volumetric ? (
          <>
            {" "}
            (volumetric — this part is bulky for its {formatKg(shipping.weightKg)} kg
            mass)
          </>
        ) : null}
        .{" "}
        {firm
          ? "Cost is calculated per seller and destination at checkout."
          : shipping.state === "pending"
            ? "Refining this estimate in the background — the exact cost is confirmed per seller at checkout."
            : "This is an estimate from the part type; the exact cost is confirmed per seller at checkout."}
      </span>
    </li>
  );
}
