"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@repo/ui/button";
import { Badge } from "@repo/ui/badge";
import { Input } from "@repo/ui/field";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import {
  CarIcon,
  ShieldCheckIcon,
  TrashIcon,
  CheckCircleIcon,
  SearchIcon,
} from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { VehiclePicker } from "@/components/VehiclePicker";
import {
  useGarage,
  vehicleShortLabel,
  type SavedVehicle,
} from "@/lib/garage-context";
import { useToast } from "@/lib/toast-context";

function VehicleCard({ vehicle }: { vehicle: SavedVehicle }) {
  const { activeVehicle, setActive, removeVehicle, updateVehicle } = useGarage();
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [nickname, setNickname] = useState(vehicle.nickname ?? "");
  const [vin, setVin] = useState(vehicle.vin ?? "");

  const isActive = activeVehicle?.id === vehicle.id;
  const years =
    vehicle.startYear && vehicle.endYear
      ? `${vehicle.startYear}–${vehicle.endYear}`
      : vehicle.startYear
        ? `${vehicle.startYear}–`
        : null;

  const saveDetails = (e: FormEvent) => {
    e.preventDefault();
    updateVehicle(vehicle.id, {
      nickname: nickname.trim() || null,
      vin: vin.trim() || null,
    });
    setEditing(false);
    push({ title: "Vehicle details updated", tone: "success" });
  };

  return (
    <article
      className={cn(
        "rounded-xl border bg-white p-5 shadow-card transition-colors",
        isActive ? "border-amber-300 ring-2 ring-amber-200" : "border-slate-200",
      )}
      aria-label={vehicleShortLabel(vehicle)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
              isActive ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-graphite-600",
            )}
          >
            <CarIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-slate-900">
                {vehicleShortLabel(vehicle)}
              </h3>
              {isActive && (
                <Badge tone="warning" size="sm" icon={<CheckCircleIcon />}>
                  Active
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-graphite-600">
              {vehicle.makeName} {vehicle.modelName} · {vehicle.generationName}
              {years ? ` (${years})` : ""}
            </p>
            {(vehicle.engine || vehicle.transmission) && (
              <p className="text-sm text-graphite-600">
                {[vehicle.engine, vehicle.transmission, vehicle.trim].filter(Boolean).join(" · ")}
              </p>
            )}
            {vehicle.vin && <p className="part-number mt-1 text-graphite-700">VIN {vehicle.vin}</p>}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setConfirmingRemove(true)}
          aria-label={`Remove ${vehicleShortLabel(vehicle)} from garage`}
          className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <TrashIcon className="h-[18px] w-[18px]" />
        </button>
      </div>

      {confirmingRemove && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">Remove this vehicle?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={() => removeVehicle(vehicle.id)}>
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>
              Keep
            </Button>
          </div>
        </div>
      )}

      {editing ? (
        <form onSubmit={saveDetails} className="mt-4 space-y-3 rounded-lg bg-slate-50 p-4">
          <Input
            label="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. Weekend car"
            maxLength={40}
          />
          <Input
            label="VIN"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder="17-character VIN"
            maxLength={17}
            hint="Optional — helps support verify exact fitment faster."
          />
          <div className="flex gap-2">
            <Button size="sm" type="submit">
              Save details
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/search?vehicleConfigId=${vehicle.configId}`}
            onClick={() => setActive(vehicle.id)}
            className={buttonClasses({ size: "sm" })}
          >
            <SearchIcon className="h-4 w-4" />
            Shop parts
          </Link>
          {!isActive && (
            <Button size="sm" variant="outline" onClick={() => setActive(vehicle.id)}>
              Set as active
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Nickname / VIN
          </Button>
        </div>
      )}
    </article>
  );
}

export default function GaragePage() {
  const { vehicles, ready } = useGarage();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">My Garage</h1>
        <p className="mt-2 text-sm leading-relaxed text-graphite-600 sm:text-base">
          Save the vehicles you maintain. Your active vehicle follows you through search and
          product pages, so every listing tells you whether it fits.
        </p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-graphite-600">
          <ShieldCheckIcon className="h-4 w-4 shrink-0 text-emerald-500" />
          Stored on this device — no account needed.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px]">
        <section aria-label="Saved vehicles" className="space-y-4">
          {!ready ? (
            <>
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </>
          ) : vehicles.length === 0 ? (
            <EmptyState
              variant="page"
              icon={<CarIcon />}
              title="No vehicles saved yet"
              description="Add your car with the picker — we'll remember it and filter the catalog to parts that actually fit."
            />
          ) : (
            vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)
          )}
        </section>

        <aside aria-label="Add a vehicle">
          <div className="lg:sticky lg:top-40">
            <VehiclePicker />
          </div>
        </aside>
      </div>
    </div>
  );
}
