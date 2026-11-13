"use client";

import { useState } from "react";
import Link from "next/link";
import { FitmentBadge } from "./FitmentBadge";
import { usePartFitment } from "@/lib/use-part-fitment";
import type { FitmentState } from "@/lib/fitment";
import { useGarage, vehicleShortLabel } from "@/lib/garage-context";
import { useCart } from "@/lib/cart-context";

/** Each cart line keeps its own intended vehicle; changing the garage's active
 * vehicle never silently reassigns the rest of a mixed-vehicle cart. */
export function CartLineFitment({
  cartId,
  itemId,
  partId,
  intendedVehicleConfigId,
  fitmentStatus,
  onChanged,
}: {
  cartId?: string;
  itemId: string;
  partId?: string;
  intendedVehicleConfigId?: string | null;
  fitmentStatus?: "CONFIRMED" | "UNVERIFIED" | "NO_VEHICLE" | "CONFLICT";
  onChanged?: () => void;
}) {
  const { activeVehicle, vehicles, ready } = useGarage();
  const { setIntendedVehicle } = useCart();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intendedVehicle = vehicles.find(
    (vehicle) => vehicle.configId === intendedVehicleConfigId,
  );
  const browserState = usePartFitment(
    partId,
    intendedVehicleConfigId,
    intendedVehicle,
  );
  const serverStateByStatus: Record<
    "CONFIRMED" | "UNVERIFIED" | "NO_VEHICLE" | "CONFLICT",
    FitmentState
  > = {
    CONFIRMED: "verified",
    UNVERIFIED: "check",
    NO_VEHICLE: "unknown",
    CONFLICT: "incompatible",
  };
  const serverState: FitmentState | null = fitmentStatus
    ? serverStateByStatus[fitmentStatus]
    : null;
  const state = serverState ?? browserState;

  const assignActiveVehicle = async () => {
    if (!cartId || !activeVehicle || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setIntendedVehicle(itemId, activeVehicle.configId);
      onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update this item's vehicle.",
      );
    } finally {
      setSaving(false);
    }
  };

  const clearVehicle = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await setIntendedVehicle(itemId, null);
      onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not clear this item's vehicle.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="space-y-1.5 text-xs">
      {intendedVehicleConfigId ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-graphite-600">
            For{" "}
            {intendedVehicle
              ? vehicleShortLabel(intendedVehicle)
              : "selected vehicle"}
            :
          </span>
          {state ? (
            <FitmentBadge
              state={state}
              size="sm"
              vehicleName={
                intendedVehicle && (state === "verified" || state === "likely")
                  ? vehicleShortLabel(intendedVehicle)
                  : null
              }
            />
          ) : (
            <span role="status" className="text-graphite-600">
              Checking compatibility…
            </span>
          )}
          {(state === "check" || state === "unknown") && (
            <span className="text-amber-800">
              Compatibility is not verified for this vehicle.
            </span>
          )}
          {state === "incompatible" && (
            <span className="font-medium text-red-700">
              This item conflicts with the selected vehicle.
            </span>
          )}
          {activeVehicle &&
            activeVehicle.configId !== intendedVehicleConfigId && (
              <button
                type="button"
                onClick={() => void assignActiveVehicle()}
                disabled={saving}
                className="font-semibold text-brand-700 underline underline-offset-2 disabled:opacity-60"
              >
                {saving
                  ? "Updating…"
                  : `Check against ${vehicleShortLabel(activeVehicle)}`}
              </button>
            )}
          <button
            type="button"
            onClick={() => void clearVehicle()}
            disabled={saving}
            className="text-graphite-600 underline underline-offset-2 disabled:opacity-60"
          >
            Clear vehicle
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-graphite-600">
          <span>No vehicle is assigned to this item.</span>
          {activeVehicle ? (
            <button
              type="button"
              onClick={() => void assignActiveVehicle()}
              disabled={saving}
              className="font-semibold text-brand-700 underline underline-offset-2 disabled:opacity-60"
            >
              {saving
                ? "Checking…"
                : `Check this item against ${vehicleShortLabel(activeVehicle)}`}
            </button>
          ) : (
            <Link
              href="/garage"
              className="font-semibold text-brand-700 underline underline-offset-2"
            >
              Add a vehicle
            </Link>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
