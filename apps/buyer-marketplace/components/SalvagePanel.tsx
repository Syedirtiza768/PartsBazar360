import type { SalvageUnit } from "@/lib/types";

export function SalvagePanel({ units }: { units: SalvageUnit[] }) {
  if (!units.length) return null;
  const unit = units[0];
  const donor = unit.donorVehicle;

  return (
    <section className="rounded-none border border-stone-300 bg-[#f7f6f2] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-800">Used original / salvage</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">Exact item details</h2>
          <p className="mt-1 text-sm text-graphite-600">
            This is a unique used part removed from a donor vehicle. Photos and condition apply to this unit only.
          </p>
        </div>
        {unit.conditionGrade && (
          <span className="border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-900">
            Grade {unit.conditionGrade}
          </span>
        )}
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {donor && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-graphite-500">Donor vehicle</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {[donor.modelYear, donor.make, donor.model, donor.trim].filter(Boolean).join(" ") || "Not provided"}
            </dd>
          </div>
        )}
        {unit.originalOemNumber && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-graphite-500">Original OEM number</dt>
            <dd className="mt-1 font-mono text-sm text-slate-900">{unit.originalOemNumber}</dd>
          </div>
        )}
        {donor?.vinMasked && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-graphite-500">VIN (masked)</dt>
            <dd className="mt-1 font-mono text-sm text-slate-900">{donor.vinMasked}</dd>
          </div>
        )}
        {typeof donor?.mileage === "number" && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-graphite-500">Donor mileage</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {donor.mileage.toLocaleString()} {donor.mileageUnit || "km"}
            </dd>
          </div>
        )}
        {unit.testedStatus && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-graphite-500">Testing</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">{unit.testedStatus}</dd>
          </div>
        )}
        {unit.warranty && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-graphite-500">Warranty</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">{unit.warranty}</dd>
          </div>
        )}
      </dl>

      {(unit.damageNotes || (unit.missingComponents && unit.missingComponents.length > 0)) && (
        <div className="mt-4 border-t border-stone-300 pt-4">
          {unit.damageNotes && (
            <p className="text-sm text-slate-800">
              <span className="font-semibold">Damage notes: </span>
              {unit.damageNotes}
            </p>
          )}
          {unit.missingComponents && unit.missingComponents.length > 0 && (
            <p className="mt-2 text-sm text-slate-800">
              <span className="font-semibold">Missing components: </span>
              {unit.missingComponents.join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
