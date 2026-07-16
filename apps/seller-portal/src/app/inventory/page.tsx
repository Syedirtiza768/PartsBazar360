"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
    const response = await fetch(`${API_BASE_URL}/merchant/inventory/${id}?sellerId=${DEMO_SELLER_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: newPrice })
    });
    const updated = await response.json();
    if (response.ok) setInventory(inventory.map(item => item.id === id ? updated : item));
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Catalog Control</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Inventory management</h1>
          <p className="text-slate-600 mt-1">Manage pricing, stock levels, listing status, and product quality.</p>
        </div>
        <Link href="/uploads" className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors">
          Import CSV
        </Link>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-6 py-4 font-semibold w-16"></th>
              <th className="px-6 py-4 font-semibold">Part title</th>
              <th className="px-6 py-4 font-semibold">Condition</th>
              <th className="px-6 py-4 font-semibold">Submitted price</th>
              <th className="px-6 py-4 font-semibold">Buyer price</th>
              <th className="px-6 py-4 font-semibold">Your proceeds</th>
              <th className="px-6 py-4 font-semibold">Stock</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={9} className="px-6 py-10 text-center text-slate-500">Loading inventory...</td></tr>}
            {!loading && inventory.length === 0 && <tr><td colSpan={9} className="px-6 py-10 text-center text-slate-500">No inventory found. Upload listings to start selling.</td></tr>}
            {!loading && inventory.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <PartThumbnail src={item.canonicalPart?.imageUrls?.[0]} alt={item.canonicalPart?.title || 'Part'} />
                </td>
                <td className="px-6 py-4 font-medium text-slate-950">{item.canonicalPart?.title || 'Unknown Part'}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                    {item.condition}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <input
                    type="number"
                    defaultValue={item.sellerBasePrice ?? item.price}
                    onBlur={(e) => handlePriceUpdate(item.id, parseFloat(e.target.value))}
                    className="bg-white border border-slate-300 rounded-md px-2 py-1.5 w-24 text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </td>
                <td className="px-6 py-4"><p className="font-semibold text-slate-950">{item.currency} {Number(item.price).toFixed(2)}</p><p className="text-xs text-slate-500">Fee {item.currency} {Number(item.marketplaceFee || 0).toFixed(2)}</p></td>
                <td className="px-6 py-4 font-semibold text-emerald-700">{item.currency} {Number(item.sellerProceeds ?? item.price).toFixed(2)}</td>
                <td className="px-6 py-4 text-slate-700">{item.inventory[0]?.quantity || 0}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                    item.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
                  }`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-emerald-700 hover:text-emerald-600 text-sm font-semibold transition-colors">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
