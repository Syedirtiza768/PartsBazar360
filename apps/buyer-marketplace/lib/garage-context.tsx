"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Device-local garage. There is no buyer authentication yet (the server
 * garage endpoint is a single shared mock user), so the buyer's vehicles and
 * "active vehicle" live in localStorage. The shape mirrors UserVehicle +
 * VehicleConfiguration so a future auth'd sync is a straight mapping.
 */

export interface SavedVehicle {
  id: string;
  configId: string;
  makeName: string;
  modelName: string;
  generationName: string;
  startYear?: number | null;
  endYear?: number | null;
  trim?: string | null;
  engine?: string | null;
  transmission?: string | null;
  nickname?: string | null;
  vin?: string | null;
  addedAt: string;
}

const STORAGE_KEY = "pb360_garage_v1";

interface GarageState {
  vehicles: SavedVehicle[];
  activeId: string | null;
}

interface GarageContextValue {
  vehicles: SavedVehicle[];
  activeVehicle: SavedVehicle | null;
  /** True once localStorage has been read (avoids SSR/first-paint flicker). */
  ready: boolean;
  addVehicle: (vehicle: Omit<SavedVehicle, "id" | "addedAt">) => SavedVehicle;
  updateVehicle: (id: string, patch: Partial<Pick<SavedVehicle, "nickname" | "vin">>) => void;
  removeVehicle: (id: string) => void;
  setActive: (id: string | null) => void;
}

const GarageContext = createContext<GarageContextValue | undefined>(undefined);

function readStorage(): GarageState {
  if (typeof window === "undefined") return { vehicles: [], activeId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { vehicles: [], activeId: null };
    const parsed = JSON.parse(raw) as GarageState;
    if (!Array.isArray(parsed.vehicles)) return { vehicles: [], activeId: null };
    return { vehicles: parsed.vehicles, activeId: parsed.activeId ?? null };
  } catch {
    return { vehicles: [], activeId: null };
  }
}

function writeStorage(state: GarageState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/blocked — the garage degrades to session-only.
  }
}

export function GarageProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GarageState>({ vehicles: [], activeId: null });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(readStorage());
    setReady(true);
  }, []);

  const persist = useCallback((next: GarageState) => {
    setState(next);
    writeStorage(next);
  }, []);

  const addVehicle = useCallback(
    (vehicle: Omit<SavedVehicle, "id" | "addedAt">) => {
      const existing = state.vehicles.find((v) => v.configId === vehicle.configId);
      if (existing) {
        persist({ ...state, activeId: existing.id });
        return existing;
      }
      const saved: SavedVehicle = {
        ...vehicle,
        id: crypto.randomUUID(),
        addedAt: new Date().toISOString(),
      };
      persist({ vehicles: [saved, ...state.vehicles], activeId: saved.id });
      return saved;
    },
    [state, persist],
  );

  const updateVehicle = useCallback(
    (id: string, patch: Partial<Pick<SavedVehicle, "nickname" | "vin">>) => {
      persist({
        ...state,
        vehicles: state.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)),
      });
    },
    [state, persist],
  );

  const removeVehicle = useCallback(
    (id: string) => {
      persist({
        vehicles: state.vehicles.filter((v) => v.id !== id),
        activeId: state.activeId === id ? null : state.activeId,
      });
    },
    [state, persist],
  );

  const setActive = useCallback(
    (id: string | null) => {
      persist({ ...state, activeId: id });
    },
    [state, persist],
  );

  const activeVehicle = useMemo(
    () => state.vehicles.find((v) => v.id === state.activeId) ?? null,
    [state],
  );

  const value = useMemo(
    () => ({
      vehicles: state.vehicles,
      activeVehicle,
      ready,
      addVehicle,
      updateVehicle,
      removeVehicle,
      setActive,
    }),
    [state.vehicles, activeVehicle, ready, addVehicle, updateVehicle, removeVehicle, setActive],
  );

  return <GarageContext.Provider value={value}>{children}</GarageContext.Provider>;
}

export function useGarage() {
  const ctx = useContext(GarageContext);
  if (!ctx) throw new Error("useGarage must be used within a GarageProvider");
  return ctx;
}

/** "BMW 7 Series (F01/F02)" or the nickname when set. */
export function vehicleShortLabel(v: SavedVehicle): string {
  return v.nickname || `${v.makeName} ${v.modelName}`;
}

/** Full descriptor: "BMW 7 Series F01 (2008–2015) · 3.0L · Automatic". */
export function vehicleFullLabel(v: SavedVehicle): string {
  const years =
    v.startYear && v.endYear
      ? ` (${v.startYear}–${v.endYear})`
      : v.startYear
        ? ` (${v.startYear}–)`
        : "";
  const specs = [v.engine, v.transmission].filter(Boolean).join(" · ");
  return `${v.makeName} ${v.modelName} ${v.generationName}${years}${specs ? ` · ${specs}` : ""}`;
}
