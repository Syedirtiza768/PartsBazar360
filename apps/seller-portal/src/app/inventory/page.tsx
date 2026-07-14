"use client";

import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { DEMO_SELLER_ID } from '@/lib/config';
import { PartThumbnail } from '@/components/PartThumbnail';

export default function InventoryPage() {
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/merchant/inventory?sellerId=${DEMO_SELLER_ID}`)
      .then(res => res.json())
      .then(data => {
        setInventory(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const handlePriceUpdate = async (id: string, newPrice: number) => {
    await fetch(`${API_BASE_URL}/merchant/inventory/${id}?sellerId=${DEMO_SELLER_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: newPrice })
    });
    // Optimistic update
    setInventory(inventory.map(item => item.id === id ? { ...item, price: newPrice } : item));
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>
          <p className="text-zinc-400 mt-1">Manage pricing, stock levels, and active status.</p>
        </div>
        <button className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 transition-colors">
          Import CSV
        </button>
      </header>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden backdrop-blur-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400">
            <tr>
              <th className="px-6 py-4 font-medium w-16"></th>
              <th className="px-6 py-4 font-medium">Part Title</th>
              <th className="px-6 py-4 font-medium">Condition</th>
              <th className="px-6 py-4 font-medium">Price (AED)</th>
              <th className="px-6 py-4 font-medium">Stock</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading && <tr><td colSpan={7} className="px-6 py-8 text-center text-zinc-500">Loading inventory...</td></tr>}
            {!loading && inventory.map((item) => (
              <tr key={item.id} className="hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4">
                  <PartThumbnail src={item.canonicalPart?.imageUrls?.[0]} alt={item.canonicalPart?.title || 'Part'} />
                </td>
                <td className="px-6 py-4 font-medium text-white">{item.canonicalPart?.title || 'Unknown Part'}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300">
                    {item.condition}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <input 
                    type="number" 
                    defaultValue={item.price}
                    onBlur={(e) => handlePriceUpdate(item.id, parseFloat(e.target.value))}
                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 w-24 text-white focus:outline-none focus:border-blue-500"
                  />
                </td>
                <td className="px-6 py-4">{item.inventory[0]?.quantity || 0}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    item.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
