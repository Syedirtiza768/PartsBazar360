"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@repo/ui/button";
import { Select } from "@repo/ui/field";
import { CarIcon, ShieldCheckIcon } from "@repo/ui/icons";
import { cn } from "@repo/ui/cn";
import { API_BASE_URL } from "@/lib/api";
import { useGarage, type SavedVehicle } from "@/lib/garage-context";
import { useToast } from "@/lib/toast-context";

export interface VehicleMakeOption {
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

type FieldKey = "makes" | "models" | "generations" | "configs";

function configLabel(c: Config): string {
  const engine = c.engine || "Standard";
  return [engine, c.transmission, c.trim].filter(Boolean).join(" · ");
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T[]> {
  const res = await fetch(`${API_BASE_URL}${url}`, {
    cache: "force-cache",
    signal,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Guided Make → Model → Generation → Engine flow. Completing it saves the
 * vehicle to the device garage and makes it the active vehicle, so fitment
 * context follows the buyer through search, product pages, and cart.
 *
 * Pass `initialMakes` from a Server Component to avoid a post-hydrate blank
 * Make dropdown while `/vehicles/makes` loads.
 */
export function VehiclePicker({
  variant = "panel",
  onDone,
  initialMakes,
}: {
  variant?: "hero" | "panel";
  onDone?: (vehicle: SavedVehicle) => void;
  initialMakes?: VehicleMakeOption[];
}) {
  const router = useRouter();
  const { addVehicle } = useGarage();
  const { push } = useToast();

  const [makes, setMakes] = useState<VehicleMakeOption[]>(initialMakes ?? []);
  const [models, setModels] = useState<Model[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);

  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [genId, setGenId] = useState("");
  const [configId, setConfigId] = useState("");

  const [loading, setLoading] = useState<Partial<Record<FieldKey, boolean>>>({
    makes: !initialMakes?.length,
  });
  const [errorField, setErrorField] = useState<FieldKey | null>(null);

  const makeIdRef = useRef(makeId);
  const modelIdRef = useRef(modelId);
  const genIdRef = useRef(genId);
  makeIdRef.current = makeId;
  modelIdRef.current = modelId;
  genIdRef.current = genId;

  const aborts = useRef<Partial<Record<FieldKey, AbortController>>>({});

  const setFieldLoading = useCallback((field: FieldKey, value: boolean) => {
    setLoading((prev) => {
      if (Boolean(prev[field]) === value) return prev;
      return { ...prev, [field]: value };
    });
  }, []);

  const loadField = useCallback(
    async <T,>(
      field: FieldKey,
      url: string,
      apply: (items: T[]) => void,
    ) => {
      aborts.current[field]?.abort();
      const ac = new AbortController();
      aborts.current[field] = ac;
      setFieldLoading(field, true);
      setErrorField((prev) => (prev === field ? null : prev));
      try {
        const data = await fetchJson<T>(url, ac.signal);
        if (ac.signal.aborted) return;
        apply(data);
        setFieldLoading(field, false);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (ac.signal.aborted) return;
        setFieldLoading(field, false);
        setErrorField(field);
      }
    },
    [setFieldLoading],
  );

  const loadMakes = useCallback(() => {
    if (initialMakes?.length) {
      setMakes(initialMakes);
      setFieldLoading("makes", false);
      setErrorField((prev) => (prev === "makes" ? null : prev));
      return;
    }
    void loadField<VehicleMakeOption>("makes", "/vehicles/makes", setMakes);
  }, [initialMakes, loadField, setFieldLoading]);

  useEffect(() => {
    loadMakes();
    return () => {
      aborts.current.makes?.abort();
    };
  }, [loadMakes]);

  useEffect(() => {
    setModels([]);
    setGenerations([]);
    setConfigs([]);
    setModelId("");
    setGenId("");
    setConfigId("");
    setErrorField((prev) =>
      prev === "models" || prev === "generations" || prev === "configs" ? null : prev,
    );
    setLoading((prev) => ({ ...prev, models: false, generations: false, configs: false }));
    aborts.current.models?.abort();
    aborts.current.generations?.abort();
    aborts.current.configs?.abort();
    if (!makeId) return;
    void loadField<Model>("models", `/vehicles/makes/${makeId}/models`, setModels);
    return () => aborts.current.models?.abort();
  }, [makeId, loadField]);

  useEffect(() => {
    setGenerations([]);
    setConfigs([]);
    setGenId("");
    setConfigId("");
    setErrorField((prev) => (prev === "generations" || prev === "configs" ? null : prev));
    setLoading((prev) => ({ ...prev, generations: false, configs: false }));
    aborts.current.generations?.abort();
    aborts.current.configs?.abort();
    if (!modelId) return;
    void loadField<Generation>(
      "generations",
      `/vehicles/models/${modelId}/generations`,
      setGenerations,
    );
    return () => aborts.current.generations?.abort();
  }, [modelId, loadField]);

  useEffect(() => {
    setConfigs([]);
    setConfigId("");
    setErrorField((prev) => (prev === "configs" ? null : prev));
    setLoading((prev) => ({ ...prev, configs: false }));
    aborts.current.configs?.abort();
    if (!genId) return;
    void loadField<Config>(
      "configs",
      `/vehicles/generations/${genId}/configurations`,
      setConfigs,
    );
    return () => aborts.current.configs?.abort();
  }, [genId, loadField]);

  const handleRetry = () => {
    if (!errorField) return;
    if (errorField === "makes") {
      // Force a network retry even when SSR seeded makes (seed may have been empty/stale).
      void loadField<VehicleMakeOption>("makes", "/vehicles/makes", setMakes);
      return;
    }
    if (errorField === "models" && makeIdRef.current) {
      void loadField<Model>(
        "models",
        `/vehicles/makes/${makeIdRef.current}/models`,
        setModels,
      );
      return;
    }
    if (errorField === "generations" && modelIdRef.current) {
      void loadField<Generation>(
        "generations",
        `/vehicles/models/${modelIdRef.current}/generations`,
        setGenerations,
      );
      return;
    }
    if (errorField === "configs" && genIdRef.current) {
      void loadField<Config>(
        "configs",
        `/vehicles/generations/${genIdRef.current}/configurations`,
        setConfigs,
      );
    }
  };

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

  const makesLoading = Boolean(loading.makes);
  const modelsLoading = Boolean(loading.models);
  const gensLoading = Boolean(loading.generations);
  const configsLoading = Boolean(loading.configs);

  const makePlaceholder = makesLoading ? "Loading makes…" : "Select make…";
  const modelPlaceholder = !makeId
    ? "Select model…"
    : modelsLoading
      ? "Loading models…"
      : models.length === 0
        ? "No models available"
        : "Select model…";
  const genPlaceholder = !modelId
    ? "Select generation…"
    : gensLoading
      ? "Loading generations…"
      : generations.length === 0
        ? "No generations available"
        : "Select generation…";
  const configPlaceholder = !genId
    ? "Select engine…"
    : configsLoading
      ? "Loading engines…"
      : configs.length === 0
        ? "No engines available"
        : "Select engine…";

  const stepDone = "border-emerald-300 bg-emerald-50 text-emerald-700";
  const stepActive = "border-brand-300 bg-brand-50 text-brand-700";
  const stepIdle = "border-slate-200 bg-slate-50 text-graphite-600";
  const stepLoading = "border-brand-200 bg-brand-50/60 text-brand-600 animate-pulse";

  const steps = [
    { n: 1, done: !!makeId, active: !makeId, loading: makesLoading },
    { n: 2, done: !!modelId, active: !!makeId && !modelId, loading: modelsLoading },
    { n: 3, done: !!genId, active: !!modelId && !genId, loading: gensLoading },
    { n: 4, done: !!configId, active: !!genId && !configId, loading: configsLoading },
  ];

  return (
    <section
      aria-label="Select your vehicle"
      aria-busy={makesLoading || modelsLoading || gensLoading || configsLoading}
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
                s.done
                  ? stepDone
                  : s.loading
                    ? stepLoading
                    : s.active
                      ? stepActive
                      : stepIdle,
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
          disabled={makesLoading || makes.length === 0}
          hint={makesLoading ? "Loading makes…" : undefined}
        >
          <option value="">{makePlaceholder}</option>
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
          disabled={!makeId || modelsLoading}
          hint={
            !makeId
              ? "Choose a make first"
              : modelsLoading
                ? "Loading models…"
                : undefined
          }
        >
          <option value="">{modelPlaceholder}</option>
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
          disabled={!modelId || gensLoading}
          hint={
            !modelId
              ? "Choose a model first"
              : gensLoading
                ? "Loading generations…"
                : undefined
          }
        >
          <option value="">{genPlaceholder}</option>
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
          disabled={!genId || configsLoading}
          hint={
            !genId
              ? "Choose a generation first"
              : configsLoading
                ? "Loading engines…"
                : undefined
          }
        >
          <option value="">{configPlaceholder}</option>
          {configs.map((c) => (
            <option key={c.id} value={c.id}>
              {configLabel(c)}
            </option>
          ))}
        </Select>
      </div>

      {errorField && (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          <p>Couldn&apos;t load vehicle data. Check your connection and try again.</p>
          <button
            type="button"
            onClick={handleRetry}
            className="shrink-0 font-semibold underline underline-offset-2 hover:text-red-900"
          >
            Retry
          </button>
        </div>
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
