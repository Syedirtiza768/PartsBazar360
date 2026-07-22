"use client";

import Link from "next/link";
import { useAdminAuth } from "@/lib/auth-context";

const NAV_ITEMS = [
  { label: "Overview", href: "/" },
  { label: "Catalog queues", href: "/catalog" },
  { label: "Marketplace Health", href: "/" },
  { label: "Portal Access", href: "/" },
];

export function Sidebar() {
  const { user, logout } = useAdminAuth();
  const initial = (user?.name || user?.email || "A").charAt(0).toUpperCase();

  return (
    <aside className="w-64 bg-white text-slate-700 border-r border-slate-200 h-screen flex flex-col shadow-sm">
      <div className="p-6 border-b border-slate-100">
        <h2 className="text-2xl font-bold tracking-tight text-slate-950">
          PartsBazar<span className="text-blue-600">360</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider">Admin Console</p>
      </div>

      <nav className="flex-1 px-3 space-y-1 mt-4">
        {NAV_ITEMS.map((item) => (
          <Link
            key={`${item.href}-${item.label}`}
            href={item.href}
            className="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-100 hover:text-slate-950 transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-200 space-y-3">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center font-semibold">
            {initial}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-slate-950 truncate">
              {user?.name || "Platform Admin"}
            </span>
            <span className="text-xs text-slate-500 truncate">{user?.email || "admin@partsbazar360.com"}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
