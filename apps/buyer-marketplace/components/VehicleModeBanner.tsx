"use client";

import Link from "next/link";
import { CarIcon, ShieldCheckIcon, XIcon } from "@repo/ui/icons";
import { useGarage, vehicleFullLabel } from "@/lib/garage-context";

/**
 * Shown on search results filtered to a vehicle configuration. Explains what
 * the buyer is looking at (only verified-fit parts) and offers a clear exit.
 * The label comes from the device garage; unknown config ids (e.g. shared
 * links) still get an honest generic banner.
 */
export function VehicleModeBanner({ configId }: { configId: string }) {
  const { vehicles, ready } = useGarage();
  const vehicle = ready ? vehicles.find((v) => v.configId === configId) : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
          <CarIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {vehicle ? vehicleFullLabel(vehicle) : "Parts for your selected vehicle"}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-800">
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            Showing only parts with verified compatibility evidence for this configuration.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pl-12 sm:pl-0">
        <Link
          href="/garage"
          className="text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
        >
          Change vehicle
        </Link>
        <Link
          href="/search"
          className="inline-flex items-center gap-1 text-sm font-medium text-graphite-600 transition-colors hover:text-slate-700"
        >
          <XIcon className="h-4 w-4" />
          Show all parts
        </Link>
      </div>
    </div>
  );
}
