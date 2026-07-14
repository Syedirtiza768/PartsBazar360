"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/lib/api';

export function VehicleSelector() {
  const router = useRouter();
  const [makes, setMakes] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [generations, setGenerations] = useState<any[]>([]);
  const [configs, setConfigs] = useState<any[]>([]);

  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedGen, setSelectedGen] = useState('');
  const [selectedConfig, setSelectedConfig] = useState('');

  useEffect(() => {
    fetch(`${API_BASE_URL}/vehicles/makes`)
      .then((res) => res.json())
      .then((data) => setMakes(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    if (selectedMake) {
      fetch(`${API_BASE_URL}/vehicles/makes/${selectedMake}/models`)
        .then((res) => res.json())
        .then((data) => setModels(Array.isArray(data) ? data : []))
        .catch((err) => console.error(err));
      setSelectedModel('');
      setGenerations([]);
      setConfigs([]);
    }
  }, [selectedMake]);

  useEffect(() => {
    if (selectedModel) {
      fetch(`${API_BASE_URL}/vehicles/models/${selectedModel}/generations`)
        .then((res) => res.json())
        .then((data) => setGenerations(Array.isArray(data) ? data : []))
        .catch((err) => console.error(err));
      setSelectedGen('');
      setConfigs([]);
    }
  }, [selectedModel]);

  useEffect(() => {
    if (selectedGen) {
      fetch(`${API_BASE_URL}/vehicles/generations/${selectedGen}/configurations`)
        .then((res) => res.json())
        .then((data) => setConfigs(Array.isArray(data) ? data : []))
        .catch((err) => console.error(err));
      setSelectedConfig('');
    }
  }, [selectedGen]);

  const [savingToGarage, setSavingToGarage] = useState(false);
  const [garageMessage, setGarageMessage] = useState<string | null>(null);

  const handleSearch = () => {
    if (selectedConfig) {
      router.push(`/search?vehicleConfigId=${selectedConfig}`);
    }
  };

  const handleSaveToGarage = async () => {
    if (!selectedConfig) return;
    setSavingToGarage(true);
    setGarageMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/garage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleConfigId: selectedConfig }),
      });
      if (!res.ok) throw new Error('Failed to save vehicle');
      setGarageMessage('Saved to My Garage!');
    } catch (err) {
      console.error(err);
      setGarageMessage('Could not save this vehicle. Please try again.');
    } finally {
      setSavingToGarage(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-xl border border-slate-100 flex flex-col gap-4">
      <h3 className="font-semibold text-slate-900 text-lg">Select Your Vehicle</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <select
          className="block w-full rounded-lg border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 bg-slate-50"
          value={selectedMake}
          onChange={(e) => setSelectedMake(e.target.value)}
        >
          <option value="">1. Select Make</option>
          {makes.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        <select
          className="block w-full rounded-lg border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 bg-slate-50 disabled:opacity-50"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={!selectedMake}
        >
          <option value="">2. Select Model</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        <select
          className="block w-full rounded-lg border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 bg-slate-50 disabled:opacity-50"
          value={selectedGen}
          onChange={(e) => setSelectedGen(e.target.value)}
          disabled={!selectedModel}
        >
          <option value="">3. Select Year / Gen</option>
          {generations.map((m) => (
            <option key={m.id} value={m.id}>{m.name} ({m.startYear}-{m.endYear})</option>
          ))}
        </select>

        <select
          className="block w-full rounded-lg border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 bg-slate-50 disabled:opacity-50"
          value={selectedConfig}
          onChange={(e) => setSelectedConfig(e.target.value)}
          disabled={!selectedGen}
        >
          <option value="">4. Select Engine / Trim</option>
          {configs.map((m) => (
            <option key={m.id} value={m.id}>{m.engine || 'Standard'} {m.transmission ? `- ${m.transmission}` : ''}</option>
          ))}
        </select>
      </div>

      <button
        onClick={handleSearch}
        disabled={!selectedConfig}
        className="mt-4 w-full rounded-lg bg-blue-600 px-3.5 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
      >
        Shop Parts for this Vehicle
      </button>

      <button
        onClick={handleSaveToGarage}
        disabled={!selectedConfig || savingToGarage}
        className="w-full rounded-lg bg-white px-3.5 py-2.5 text-sm font-semibold text-blue-600 ring-1 ring-inset ring-blue-200 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {savingToGarage ? 'Saving...' : 'Save to My Garage'}
      </button>
      {garageMessage && (
        <p className="text-sm text-center text-slate-500">{garageMessage}</p>
      )}
    </div>
  );
}
