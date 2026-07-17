"use client";

import { useEffect, useState } from "react";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { TagIcon } from "@repo/ui/icons";
import { API_BASE_URL } from "@/lib/api";
import { DEMO_SELLER_ID } from "@/lib/config";
import { PageHeader } from "@/components/PageHeader";

interface Assignment {
  id: string;
  category?: string | null;
  pricingPolicy: {
    name: string;
    version: number;
    mode: string;
    percentRate: number;
    fixedFee: number;
    currency: string;
  };
}

interface Quote {
  sellerBasePrice: number;
  customerPrice: number;
  marketplaceFee: number;
  sellerProceeds: number;
  currency: string;
}

export default function PricingPage() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [basePrice, setBasePrice] = useState("100");
  const [category, setCategory] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/merchant/pricing?sellerId=${DEMO_SELLER_ID}`)
      .then((response) => response.json())
      .then((data) => setAssignments(Array.isArray(data) ? data : []))
      .catch(() => setError("Could not load commercial terms."));
  }, []);

  const preview = async () => {
    setError(null);
    const price = parseFloat(basePrice);
    if (Number.isNaN(price) || price < 0) {
      setError("Enter a valid base amount.");
      return;
    }
    setQuoting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/merchant/pricing/quote?sellerId=${DEMO_SELLER_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerBasePrice: price, category: category || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not calculate price.");
      setQuote(data);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not calculate price.");
    } finally {
      setQuoting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Commercial terms"
        title="Pricing & seller proceeds"
        description="Review the policies assigned to your account and preview exactly what a buyer pays and what you receive."
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card" aria-label="Active policy assignments">
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Active policy assignments</h2>
        </div>
        {assignments === null ? (
          <div className="space-y-3 p-5" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<TagIcon />}
              title="No active pricing policy"
              description="Offers retain their submitted price until operations assigns commercial terms to your account."
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between sm:px-6">
                <div>
                  <p className="font-semibold text-slate-900">{assignment.pricingPolicy.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {assignment.category || "All categories"} · v{assignment.pricingPolicy.version} ·{" "}
                    <span className="capitalize">{assignment.pricingPolicy.mode.replace(/_/g, " ").toLowerCase()}</span>
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-2xl font-bold tabular-nums text-slate-900">
                    {(assignment.pricingPolicy.percentRate * 100).toFixed(2)}%
                  </p>
                  <p className="text-xs text-slate-500">
                    + {assignment.pricingPolicy.currency} {assignment.pricingPolicy.fixedFee.toFixed(2)} fixed fee
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-label="Price preview">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Price preview</h2>
          <p className="mt-1 text-sm text-slate-500">
            See the split between your submitted amount, buyer price, marketplace fee, and your proceeds.
          </p>
        </div>
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
          <Input
            label="Submitted / base amount"
            type="number"
            min={0}
            step="0.01"
            value={basePrice}
            onChange={(event) => setBasePrice(event.target.value)}
          />
          <Input
            label="Category"
            hint="Optional — uses your category-specific policy if one exists"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
          <Button onClick={preview} loading={quoting} className="md:mb-6">
            Calculate
          </Button>
        </div>

        {quote && (
          <dl className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-5 lg:grid-cols-4">
            {[
              { label: "Seller base", value: quote.sellerBasePrice },
              { label: "Buyer pays", value: quote.customerPrice },
              { label: "Marketplace fee", value: quote.marketplaceFee },
              { label: "You receive", value: quote.sellerProceeds, highlight: true },
            ].map((metric) => (
              <div key={metric.label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{metric.label}</dt>
                <dd className={`mt-1 text-xl font-bold tabular-nums ${metric.highlight ? "text-emerald-700" : "text-slate-900"}`}>
                  {quote.currency} {Number(metric.value).toFixed(2)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
