"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, FormEvent } from 'react';
import { useCart } from '@/lib/cart-context';

export function Header() {
  const { itemCount } = useCart();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    router.push(`/search?${params.toString()}`);
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200">
      {/* Top utility bar */}
      <div className="hidden sm:block bg-slate-900 text-slate-300 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-8 flex items-center justify-between">
          <p>Fitment-verified OEM used and aftermarket auto parts, shipped worldwide.</p>
          <div className="flex items-center gap-4">
            <Link href="/garage" className="hover:text-white transition-colors">My Garage</Link>
            <span className="text-slate-600">|</span>
            <span>Live from 11 verified marketplace sellers</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
        <Link href="/" className="text-2xl font-black text-blue-600 tracking-tight shrink-0">
          PartsBazar<span className="text-emerald-500">360</span>
        </Link>

        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-slate-600 shrink-0">
          <Link href="/search" className="hover:text-blue-600 transition-colors">Shop All Parts</Link>
          <Link href="/" className="hover:text-blue-600 transition-colors">Find by Vehicle</Link>
          <Link href="/support" className="hover:text-blue-600 transition-colors">Support</Link>
        </nav>

        <form onSubmit={handleSearch} className="flex-1 max-w-xl mx-auto">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by part, brand, OE number..."
              className="w-full rounded-full border border-slate-200 bg-slate-50 py-2.5 pl-4 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            </button>
          </div>
        </form>

        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/cart"
            className="relative flex items-center gap-2 px-3 sm:px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-full hover:bg-slate-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            <span className="hidden sm:inline">Cart</span>
            {itemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-5 h-5 text-[11px] font-bold bg-emerald-500 text-white rounded-full">
                {itemCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
