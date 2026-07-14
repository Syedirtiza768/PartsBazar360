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
      body: JSON.stringify({ trackingNumber: tracking, carrier: 'DHL' }) // Mocking carrier for MVP
    });
    
    fetchOrders();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Order Fulfillment Queue</h1>
        <p className="text-zinc-400 mt-1">Review pending orders and upload tracking numbers to fulfill.</p>
      </header>

      <div className="space-y-4">
        {loading && <p className="text-zinc-500">Loading orders...</p>}
        {!loading && orders.length === 0 && <p className="text-zinc-500">No orders found.</p>}
        
        {!loading && orders.map(order => (
          <div key={order.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
            
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-zinc-400">Order #{order.id.split('-')[0]}</span>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  order.status === 'PROCESSING' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                }`}>
                  {order.status}
                </span>
              </div>
              <h3 className="font-medium text-lg">
                {order.items.length} items • AED {order.subTotal + order.shippingTotal}
              </h3>
              <p className="text-sm text-zinc-500">Created: {new Date(order.createdAt).toLocaleString()}</p>
            </div>

            <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 w-full md:w-auto min-w-[300px]">
              <h4 className="text-xs font-medium text-zinc-500 mb-2 uppercase tracking-wider">Items to ship</h4>
              <ul className="space-y-3">
                {order.items.map((item: any) => (
                  <li key={item.id} className="text-sm flex items-center gap-3 text-zinc-300">
                    <PartThumbnail
                      src={item.sellerOffer.canonicalPart?.imageUrls?.[0]}
                      alt={item.sellerOffer.canonicalPart?.title || 'Part'}
                      size={36}
                    />
                    <span className="truncate max-w-[200px]">{item.quantity}x {item.sellerOffer.canonicalPart?.title}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col items-end gap-2">
              {order.status === 'PROCESSING' ? (
                <button 
                  onClick={() => handleFulfill(order.id)}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_25px_rgba(37,99,235,0.5)]"
                >
                  Mark as Shipped
                </button>
              ) : (
                <div className="text-right">
                  <p className="text-sm text-emerald-400 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    Shipped
                  </p>
                  {order.trackingNumber && (
                    <p className="text-xs font-mono text-zinc-500 mt-1">
                      {order.carrier} {order.trackingNumber}
                    </p>
                  )}
                </div>
              )}
            </div>
            
          </div>
        ))}
      </div>
    </div>
  );
}
