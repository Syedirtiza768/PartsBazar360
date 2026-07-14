"use client";

import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { DEMO_SELLER_ID } from '@/lib/config';

export default function DashboardPage() {
  const [stats, setStats] = useState({ activeListings: 0, pendingOrders: 0, totalRevenue: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/merchant/analytics/summary?sellerId=${DEMO_SELLER_ID}`)
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-zinc-400 mt-1">Here is a summary of your store's performance.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 backdrop-blur-sm hover:border-zinc-700 transition-colors">
          <h3 className="text-sm font-medium text-zinc-400">Total Revenue</h3>
          <div className="text-4xl font-bold mt-2 flex items-baseline gap-2">
            AED {loading ? '...' : stats.totalRevenue?.toLocaleString()}
          </div>
        </div>
        
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 backdrop-blur-sm hover:border-zinc-700 transition-colors">
          <h3 className="text-sm font-medium text-zinc-400">Pending Orders</h3>
          <div className="text-4xl font-bold mt-2 text-amber-400">
            {loading ? '...' : stats.pendingOrders}
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 backdrop-blur-sm hover:border-zinc-700 transition-colors">
          <h3 className="text-sm font-medium text-zinc-400">Active Listings</h3>
          <div className="text-4xl font-bold mt-2 text-emerald-400">
            {loading ? '...' : stats.activeListings}
          </div>
        </div>
      </div>
    </div>
  );
}
