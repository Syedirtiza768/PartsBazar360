"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [makes, setMakes] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [generations, setGenerations] = useState<any[]>([]);
  const [configs, setConfigs] = useState<any[]>([]);

  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedGen, setSelectedGen] = useState('');
  const [selectedConfig, setSelectedConfig] = useState('');

  // Fetch Makes on load
  useEffect(() => {
    fetch('http://localhost:3001/vehicles/makes')
      .then(res => res.json())
      .then(data => setMakes(data));
  }, []);

  // Fetch Models when Make selected
  useEffect(() => {
    if (selectedMake) {
      fetch(`http://localhost:3001/vehicles/makes/${selectedMake}/models`)
        .then(res => res.json())
        .then(data => setModels(data));
      setSelectedModel('');
      setGenerations([]);
      setConfigs([]);
    }
  }, [selectedMake]);

  // Fetch Generations when Model selected
  useEffect(() => {
    if (selectedModel) {
      fetch(`http://localhost:3001/vehicles/models/${selectedModel}/generations`)
        .then(res => res.json())
        .then(data => setGenerations(data));
      setSelectedGen('');
      setConfigs([]);
    }
  }, [selectedModel]);

  // Fetch Configs when Gen selected
  useEffect(() => {
    if (selectedGen) {
      fetch(`http://localhost:3001/vehicles/generations/${selectedGen}/configurations`)
        .then(res => res.json())
        .then(data => setConfigs(data));
      setSelectedConfig('');
    }
  }, [selectedGen]);

  const handleSearch = () => {
    if (selectedConfig) {
      router.push(`/search?vehicleConfigId=${selectedConfig}`);
    }
  };

  return (
    <div className="relative isolate overflow-hidden bg-white">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,theme(colors.blue.50),white)] opacity-50" />
      <div className="absolute inset-y-0 right-1/2 -z-10 mr-16 w-[200%] origin-bottom-left skew-x-[-30deg] bg-white shadow-xl shadow-blue-600/10 ring-1 ring-blue-50 sm:mr-28 lg:mr-0 xl:mr-16 xl:origin-center" />
      
      <div className="mx-auto max-w-7xl px-6 pb-24 pt-10 sm:pb-32 lg:flex lg:px-8 lg:py-40 items-center">
        <div className="mx-auto max-w-2xl lg:mx-0 lg:max-w-xl lg:flex-shrink-0 pt-8">
          <h1 className="mt-10 text-4xl font-black tracking-tight text-slate-900 sm:text-6xl">
            Find the exact part.<br />
            <span className="text-blue-600">Guaranteed to fit.</span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">
            Tell us what you drive, and we'll instantly filter millions of parts to show you only the ones that match your specific vehicle configuration.
          </p>
          
          {/* Vehicle Selector Form */}
          <div className="mt-10 bg-white p-6 rounded-2xl shadow-xl border border-slate-100 flex flex-col gap-4">
            <h3 className="font-semibold text-slate-900 text-lg">Select Your Vehicle</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <select 
                className="block w-full rounded-lg border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 bg-slate-50"
                value={selectedMake}
                onChange={e => setSelectedMake(e.target.value)}
              >
                <option value="">1. Select Make</option>
                {makes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>

              <select 
                className="block w-full rounded-lg border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 bg-slate-50 disabled:opacity-50"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={!selectedMake}
              >
                <option value="">2. Select Model</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>

              <select 
                className="block w-full rounded-lg border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 bg-slate-50 disabled:opacity-50"
                value={selectedGen}
                onChange={e => setSelectedGen(e.target.value)}
                disabled={!selectedModel}
              >
                <option value="">3. Select Year / Gen</option>
                {generations.map(m => <option key={m.id} value={m.id}>{m.name} ({m.startYear}-{m.endYear})</option>)}
              </select>

              <select 
                className="block w-full rounded-lg border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 sm:text-sm sm:leading-6 bg-slate-50 disabled:opacity-50"
                value={selectedConfig}
                onChange={e => setSelectedConfig(e.target.value)}
                disabled={!selectedGen}
              >
                <option value="">4. Select Engine / Trim</option>
                {configs.map(m => <option key={m.id} value={m.id}>{m.engine} - {m.transmission}</option>)}
              </select>
            </div>

            <button 
              onClick={handleSearch}
              disabled={!selectedConfig}
              className="mt-4 w-full rounded-lg bg-blue-600 px-3.5 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              Shop Parts for this Vehicle
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
