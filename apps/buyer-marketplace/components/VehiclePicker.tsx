"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@repo/ui/button";
import { Select } from "@repo/ui/field";
import { CarIcon, ShieldCheckIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { API_BASE_URL } from "@/lib/api";
import { useGarage, type SavedVehicle } from "@/lib/garage-context";
import { useToast } from "@/lib/toast-context";

interface Make {
  id: string;
  name: string;
}
interface Model {
  id: string;
  name: string;
}
interface Generation {
  id: string;
  name: string;
  startYear?: number | null;
  endYear?: number | null;
}
interface Config {
  id: string;
  trim?: string | null;
  engine?: string | null;
  transmission?: string | null;
}

type Status = "idle" | "loading" | "error";

function configLabel(c: Config): string {
  const engine = c.engine || "Standard";
  return [engine, c.transmission, c.trim].filter(Boolean).join(" · ");
}

/**
 * Guided Make → Model → Generation → Engine flow. Completing it saves the
 * vehicle to the device garage and makes it the active vehicle, so fitment
 * context follows the buyer through search, product pages, and cart.
 */
export function VehiclePicker({
  variant = "panel",
  onDone,
}: {
  variant?: "hero" | "panel";
  onDone?: (vehicle: SavedVehicle) => void;
}) {
  const router = useRouter();
  const { addVehicle } = useGarage();
  const { push } = useToast();

  const [makes, setMakes] = useState<Make[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);

  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [genId, setGenId] = useState("");
  const [configId, setConfigId] = useState("");

  const [status, setStatus] = useState<Status>("loading");

  const load = async <T,>(url: string, set: (items: T[]) => void) => {
    setStatus("loading");
    try {
      const res = await fetch(`${API_BASE_URL}${url}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      set(Array.isArray(data) ? data : []);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    load<Make>("/vehicles/makes", setMakes);
  }, []);

  useEffect(() => {
    setModels([]);
    setGenerations([]);
    setConfigs([]);
    setModelId("");
    setGenId("");
    setConfigId("");
    if (makeId) load<Model>(`/vehicles/makes/${makeId}/models`, setModels);
  }, [makeId]);

  useEffect(() => {
    setGenerations([]);
    setConfigs([]);
    setGenId("");
    setConfigId("");
    if (modelId) load<Generation>(`/vehicles/models/${modelId}/generations`, setGenerations);
  }, [modelId]);

  useEffect(() => {
    setConfigs([]);
    setConfigId("");
    if (genId) load<Config>(`/vehicles/generations/${genId}/configurations`, setConfigs);
  }, [genId]);

  const buildVehicle = (): Omit<SavedVehicle, "id" | "addedAt"> | null => {
    const make = makes.find((m) => m.id === makeId);
    const model = models.find((m) => m.id === modelId);
    const gen = generations.find((g) => g.id === genId);
    const config = configs.find((c) => c.id === configId);
    if (!make || !model || !gen || !config) return null;
    return {
      configId: config.id,
      makeName: make.name,
      modelName: model.name,
      generationName: gen.name,
      startYear: gen.startYear ?? null,
      endYear: gen.endYear ?? null,
      trim: config.trim ?? null,
      engine: config.engine ?? null,
      transmission: config.transmission ?? null,
    };
  };

  const complete = configId !== "";

  const handleShop = () => {
    const vehicle = buildVehicle();
    if (!vehicle) return;
    const saved = addVehicle(vehicle);
    onDone?.(saved);
    router.push(`/search?vehicleConfigId=${vehicle.configId}`);
  };

  const handleSaveOnly = () => {
    const vehicle = buildVehicle();
    if (!vehicle) return;
    const saved = addVehicle(vehicle);
    push({
      title: "Vehicle saved to your garage",
      description: `${vehicle.makeName} ${vehicle.modelName} is now your active vehicle.`,
      tone: "success",
    });
    onDone?.(saved);
  };

  const stepDone = "border-emerald-300 bg-emerald-50 text-emerald-700";
  const stepActive = "border-brand-300 bg-brand-50 text-brand-700";
  const stepIdle = "border-slate-200 bg-slate-50 text-graphite-600";

  const steps = [
    { n: 1, done: !!makeId, active: !makeId },
    { n: 2, done: !!modelId, active: !!makeId && !modelId },
    { n: 3, done: !!genId, active: !!modelId && !genId },
    { n: 4, done: !!configId, active: !!genId && !configId },
  ];

  return (
    <section
      aria-label="Select your vehicle"
      className={cn(
        "border bg-white",
        variant === "hero"
          ? "border-slate-950 p-4 sm:p-5"
          : "border-stone-300 p-5 shadow-card sm:p-6",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-black uppercase text-slate-950">
          <span className="flex h-9 w-9 items-center justify-center bg-signal-500 text-graphite-950">
            <CarIcon className="h-5 w-5" />
          </span>
          Select your vehicle
        </h2>
        <div className="flex items-center gap-1" aria-hidden="true">
          {steps.map((s) => (
            <span
              key={s.n}
              className={cn(
                "flex h-6 w-6 items-center justify-center border text-[11px] font-bold transition-colors",
                s.done ? stepDone : s.active ? stepActive : stepIdle,
              )}
            >
              {s.done ? "✓" : s.n}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Select
          label="Make"
          value={makeId}
          onChange={(e) => setMakeId(e.target.value)}
          disabled={makes.length === 0 && status === "loading"}
        >
          <option value="">Select make…</option>
          {makes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>

        <Select
          label="Model"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          disabled={!makeId}
          hint={!makeId ? "Choose a make first" : undefined}
        >
          <option value="">Select model…</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>

        <Select
          label="Generation / years"
          value={genId}
          onChange={(e) => setGenId(e.target.value)}
          disabled={!modelId}
        >
          <option value="">Select generation…</option>
          {generations.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {g.startYear ? ` (${g.startYear}–${g.endYear ?? "now"})` : ""}
            </option>
          ))}
        </Select>

        <Select
          label="Engine / trim"
          value={configId}
          onChange={(e) => setConfigId(e.target.value)}
          disabled={!genId}
        >
          <option value="">Select engine…</option>
          {configs.map((c) => (
            <option key={c.id} value={c.id}>
              {configLabel(c)}
            </option>
          ))}
        </Select>
      </div>

      {status === "error" && (
        <p className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          Couldn&apos;t load vehicle data. Check your connection and try again.
        </p>
      )}

      <div className="mt-5 space-y-2.5">
        <Button size="lg" fullWidth disabled={!complete} onClick={handleShop}>
          Shop parts for this vehicle
        </Button>
        <Button variant="outline" fullWidth disabled={!complete} onClick={handleSaveOnly}>
          Save to My Garage
        </Button>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-graphite-600">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        Your vehicle is remembered on this device, and every listing shows whether it fits.
      </p>
    </section>
  );
}
