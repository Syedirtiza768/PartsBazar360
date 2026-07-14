"use client";

import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { DEMO_SELLER_ID } from '@/lib/config';
import { PartThumbnail } from '@/components/PartThumbnail';

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = () => {
    fetch(`${API_BASE_URL}/merchant/orders?sellerId=${DEMO_SELLER_ID}`)
      .then(res => res.json())
      .then(data => {
        setOrders(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleFulfill = async (orderId: string) => {
    const tracking = prompt("Enter Tracking Number:");
    if (!tracking) return;

    await fetch(`${API_BASE_URL}/merchant/orders/${orderId}/fulfill?sellerId=${DEMO_SELLER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingNumber: tracking, carrier: 'DHL' })
    });

    fetchOrders();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Fulfillment</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Order fulfillment queue</h1>
          <p className="text-slate-600 mt-1">Review pending orders, pack items, and upload tracking numbers.</p>
        </div>
        <button onClick={fetchOrders} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
          Refresh orders
        </button>
      </header>

      <div className="space-y-4">
        {loading && <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">Loading orders...</div>}
        {!loading && orders.length === 0 && <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">No orders found.</div>}

        {!loading && orders.map(order => (
          <section key={order.id} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col xl:flex-row gap-6 justify-between">
              <div className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm text-slate-500">Order #{order.id.split('-')[0]}</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${
                    order.status === 'PROCESSING' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  }`}>
                    {order.status}
                  </span>
                </div>
                <h3 className="font-semibold text-lg text-slate-950">
                  {order.items.length} items / AED {order.subTotal + order.shippingTotal}
                </h3>
                <p className="text-sm text-slate-500">Created: {new Date(order.createdAt).toLocaleString()}</p>
              </div>

              <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 w-full xl:w-auto xl:min-w-[360px]">
                <h4 className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">Items to ship</h4>
                <ul className="space-y-3">
                  {order.items.map((item: any) => (
                    <li key={item.id} className="text-sm flex items-center gap-3 text-slate-700">
                      <PartThumbnail
                        src={item.sellerOffer.canonicalPart?.imageUrls?.[0]}
                        alt={item.sellerOffer.canonicalPart?.title || 'Part'}
                        size={36}
                      />
                      <span className="truncate max-w-[240px]">{item.quantity}x {item.sellerOffer.canonicalPart?.title}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex xl:flex-col items-start xl:items-end justify-between gap-2">
                {order.status === 'PROCESSING' ? (
                  <button
                    onClick={() => handleFulfill(order.id)}
                    className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
                  >
                    Mark as shipped
                  </button>
                ) : (
                  <div className="xl:text-right">
                    <p className="text-sm text-emerald-700 font-semibold">Shipped</p>
                    {order.trackingNumber && (
                      <p className="text-xs font-mono text-slate-500 mt-1">
                        {order.carrier} {order.trackingNumber}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
