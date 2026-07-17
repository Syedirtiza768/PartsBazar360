"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@repo/ui/button";
import { Checkbox, Input } from "@repo/ui/field";
import { CheckCircleIcon, ShieldCheckIcon } from "@repo/ui/icons";

const KEY = "pb360_buyer_preferences_v1";

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fitmentAlerts, setFitmentAlerts] = useState(true);
  const [orderAlerts, setOrderAlerts] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(KEY) || "{}");
      setName(stored.name || "");
      setEmail(stored.email || "");
      setFitmentAlerts(stored.fitmentAlerts ?? true);
      setOrderAlerts(stored.orderAlerts ?? true);
    } catch {
      // Ignore malformed device-local preferences and keep safe defaults.
    }
  }, []);

  const save = (event: FormEvent) => {
    event.preventDefault();
    window.localStorage.setItem(KEY, JSON.stringify({ name, email, fitmentAlerts, orderAlerts }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  return (
    <section>
      <div className="border-b-2 border-slate-950 pb-3"><p className="eyebrow">Buyer preferences</p><h2 className="mt-1 font-display text-2xl font-black uppercase text-slate-950 sm:text-3xl">Settings</h2></div>
      <form onSubmit={save} className="mt-6 max-w-2xl space-y-6">
        <section className="border border-stone-300 bg-white p-5 sm:p-6"><h3 className="font-display text-lg font-black uppercase text-slate-950">Contact details</h3><p className="mt-1 text-sm text-graphite-600">Used to prefill future buyer interactions on this device.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Input label="Full name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /><Input label="Email address" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" /></div></section>
        <section className="border border-stone-300 bg-white p-5 sm:p-6"><h3 className="font-display text-lg font-black uppercase text-slate-950">Notifications</h3><div className="mt-4 space-y-4"><Checkbox checked={fitmentAlerts} onChange={(event) => setFitmentAlerts(event.target.checked)} label="Fitment and listing updates" description="Compatibility clarification, watched listing changes, and seller replies." /><Checkbox checked={orderAlerts} onChange={(event) => setOrderAlerts(event.target.checked)} label="Order and return updates" description="Payment, dispatch, tracking, delivery, returns, and refund status." /></div></section>
        <div className="flex items-center gap-4"><Button type="submit" size="lg">Save preferences</Button>{saved && <p className="flex items-center gap-2 text-sm font-semibold text-brand-800" role="status"><CheckCircleIcon className="h-4 w-4" />Saved on this device</p>}</div>
      </form>
      <p className="mt-8 flex max-w-2xl items-start gap-2 border-t border-stone-300 pt-4 text-xs leading-relaxed text-graphite-600"><ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />These preferences are device-local until account authentication and synced notification services are connected.</p>
    </section>
  );
}
