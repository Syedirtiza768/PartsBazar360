import Link from "next/link";
import { TruckIcon } from "@repo/ui/icons";
import { Select } from "@repo/ui/field";
import { SHIPPING_COUNTRIES } from "@/lib/shipping-destination";
import type { Part, PartShipping } from "@/lib/types";

/**
 * Single, shared "ships to" control for the buy box — one destination
 * applies to every offer below it, each of which shows its own price +
 * shipping line using the resulting quote.
 */
export function ShippingDestinationPicker({
  part,
  shipping,
  destination,
  onDestinationChange,
}: {
  part: Part;
  shipping?: PartShipping | null;
  destination: string;
  onDestinationChange: (country: string) => void;
}) {
  if (shipping?.requiresFreightQuote) {
    return (
      <p className="flex items-start gap-2 text-[13px] text-slate-600">
        <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>
          <span className="font-semibold text-slate-800">Oversized item</span> — this ships as
          freight rather than courier.{" "}
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
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-graphite-600">
      <TruckIcon className="h-4 w-4 shrink-0 text-slate-400" />
      Ships to
      <Select
        hideLabel
        label="Destination country"
        value={destination}
        onChange={(e) => onDestinationChange(e.target.value)}
        className="!min-h-0 w-auto py-1 pl-2 pr-7 text-[13px]"
      >
        <option value="" disabled>
          Select country
        </option>
        {SHIPPING_COUNTRIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    </div>
  );
}
