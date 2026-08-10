import Link from "next/link";
import { TruckIcon } from "@repo/ui/icons";
import { Select } from "@repo/ui/field";
import { useCurrency } from "@/lib/currency-context";
import { usePartShippingQuote } from "@/lib/use-part-shipping-quote";
import { SHIPPING_COUNTRIES } from "@/lib/shipping-destination";
import type { Part, PartShipping } from "@/lib/types";

/**
 * Shows a live shipping cost + delivery estimate for the buyer's chosen
 * destination, with an inline country picker — falls back to the generic
 * "confirmed at checkout" message when a quote isn't available.
 */
export function ShippingSummaryRow({
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
  const { format } = useCurrency();

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

  return (
    <ShippingQuoteLine
      part={part}
      destination={destination}
      onDestinationChange={onDestinationChange}
      format={format}
    />
  );
}

function ShippingQuoteLine({
  part,
  destination,
  onDestinationChange,
  format,
}: {
  part: Part;
  destination: string;
  onDestinationChange: (country: string) => void;
  format: (amount: number, currency: string) => string;
}) {
  const { quote, loading, error } = usePartShippingQuote({
    partId: part.id,
    country: destination,
    enabled: Boolean(destination),
  });

  return (
    <li className="flex items-start gap-2.5">
      <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-graphite-600">Ships to</span>
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
        </span>
        <span>
          {!destination
            ? "Select a destination to see shipping cost."
            : loading && !quote
              ? "Calculating shipping…"
              : quote
                ? (
                  <>
                    {format(quote.amount, quote.currency)}
                    {quote.leadTime ? ` · ${quote.leadTime}` : ""}
                    {quote.weightState !== "exact" ? " (estimated)" : ""}
                  </>
                )
                : error
                  ? "Shipping cost is calculated per seller and destination at checkout."
                  : "—"}
        </span>
      </span>
    </li>
  );
}
