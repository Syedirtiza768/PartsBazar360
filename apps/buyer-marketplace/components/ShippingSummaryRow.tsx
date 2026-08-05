import Link from "next/link";
import { TruckIcon } from "@repo/ui/icons";
import type { Part, PartShipping } from "@/lib/types";

/**
 * Shows shipping cost information without exposing weight details.
 *
 * Buyers see a clear cost message; weight/billable-weight internals stay hidden.
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
        Shipping is calculated per seller and destination at checkout.
      </li>
    );
  }

  if (shipping.requiresFreightQuote) {
    return (
      <li className="flex items-start gap-2.5">
        <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>
          <span className="font-semibold text-slate-800">
            Oversized item
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

  const firm = shipping.state === "exact";

  return (
    <li className="flex items-start gap-2.5">
      <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <span>
        {firm
          ? "Shipping cost is calculated per seller and destination at checkout."
          : shipping.state === "pending"
            ? "Shipping estimate shown — the exact cost is confirmed per seller at checkout."
            : "Shipping is estimated from the part type; the exact cost is confirmed per seller at checkout."}
      </span>
    </li>
  );
}
