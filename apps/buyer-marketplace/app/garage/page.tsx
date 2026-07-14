"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/lib/api';

interface GarageVehicle {
  id: string;
  nickname?: string | null;
  vin?: string | null;
  vehicleConfigId: string;
  vehicleConfig: {
    trim?: string | null;
    engine?: string | null;
    transmission?: string | null;
    generation: {
      name: string;
      startYear?: number | null;
      endYear?: number | null;
      model: {
        name: string;
        make: { name: string };
      };
    };
  };
}

export default function GaragePage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<GarageVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGarage = () => {
    setLoading(true);
    fetch(`${API_BASE_URL}/garage`)
      .then((res) => res.json())
      .then((data) => {
        setVehicles(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Could not load your garage right now.');
        setLoading(false);
      });
  };

  useEffect(() => {
    loadGarage();
  }, []);

  const handleRemove = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/garage/${id}`, { method: 'DELETE' });
      setVehicles((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-6 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">My Garage</h1>
          <p className="text-slate-500 mt-1">Vehicles you've saved for faster, fitment-verified shopping.</p>
        </div>
        <button
          onClick={() => router.push('/')}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors"
        >
          + Add a Vehicle
        </button>
      </div>

      {loading && <p className="text-slate-500">Loading your garage...</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && vehicles.length === 0 && (
        <div className="text-center py-24 bg-white border border-slate-200 rounded-2xl">
          <p className="text-lg text-slate-600">Your garage is empty.</p>
          <p className="text-slate-500 text-sm mt-2">Select a vehicle from the homepage to add it here.</p>
          <button onClick={() => router.push('/')} className="mt-4 text-blue-600 font-medium hover:underline">
            Select your vehicle
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {vehicles.map((vehicle) => (
          <div key={vehicle.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg text-slate-900">
                  {vehicle.nickname || `${vehicle.vehicleConfig.generation.model.make.name} ${vehicle.vehicleConfig.generation.model.name}`}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {vehicle.vehicleConfig.generation.model.make.name} {vehicle.vehicleConfig.generation.model.name} · {vehicle.vehicleConfig.generation.name}
                  {vehicle.vehicleConfig.generation.startYear ? ` (${vehicle.vehicleConfig.generation.startYear}-${vehicle.vehicleConfig.generation.endYear ?? 'present'})` : ''}
                </p>
                {vehicle.vehicleConfig.engine && (
                  <p className="text-sm text-slate-500">{vehicle.vehicleConfig.engine} · {vehicle.vehicleConfig.transmission}</p>
                )}
              </div>
              <button
                onClick={() => handleRemove(vehicle.id)}
                className="text-slate-400 hover:text-red-500 transition-colors"
                aria-label="Remove vehicle"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <button
              onClick={() => router.push(`/search?vehicleConfigId=${vehicle.vehicleConfigId}`)}
              className="mt-4 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors text-sm"
            >
              Shop parts for this vehicle
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
