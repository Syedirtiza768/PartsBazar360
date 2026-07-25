"use client";

import { useEffect, useState } from "react";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
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
    <PageBody className="space-y-6 sm:space-y-8">
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
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3.5 sm:px-6">
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
              <div key={assignment.id} className="flex flex-col gap-3 p-4 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{assignment.pricingPolicy.name}</p>
                  <p className="mt-1 text-sm text-graphite-600">
                    {assignment.category || "All categories"} · v{assignment.pricingPolicy.version} ·{" "}
                    <span className="capitalize">{assignment.pricingPolicy.mode.replace(/_/g, " ").toLowerCase()}</span>
                  </p>
                </div>
                <div className="shrink-0 md:text-right">
                  <p className="text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">
                    {(assignment.pricingPolicy.percentRate * 100).toFixed(2)}%
                  </p>
                  <p className="text-xs text-graphite-600">
                    + {assignment.pricingPolicy.currency} {assignment.pricingPolicy.fixedFee.toFixed(2)} fixed fee
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6" aria-label="Price preview">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Price preview</h2>
          <p className="mt-1 text-pretty text-sm text-graphite-600">
            See the split between your submitted amount, buyer price, marketplace fee, and your proceeds.
          </p>
        </div>
        {/*
          The action sits on its own row rather than as a third grid cell. The
          old layout used `items-end` plus a hand-tuned `md:mb-6` to line the
          button up with the inputs, which broke the moment the Category hint
          wrapped to two lines — i.e. on every screen under 900px.
        */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          <Input
            label="Submitted / base amount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={basePrice}
            onChange={(event) => setBasePrice(event.target.value)}
          />
          <Input
            label="Category"
            hint="Optional — uses your category-specific policy if one exists"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </div>
        <Button onClick={preview} loading={quoting} fullWidth className="sm:w-auto">
          Calculate
        </Button>

        {quote && (
          <dl className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 lg:grid-cols-4">
            {[
              { label: "Seller base", value: quote.sellerBasePrice },
              { label: "Buyer pays", value: quote.customerPrice },
              { label: "Marketplace fee", value: quote.marketplaceFee },
              { label: "You receive", value: quote.sellerProceeds, highlight: true },
            ].map((metric) => (
              <div key={metric.label} className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-wide text-graphite-600">{metric.label}</dt>
                <dd className={`mt-1 break-anywhere text-lg font-bold tabular-nums sm:text-xl ${metric.highlight ? "text-emerald-700" : "text-slate-900"}`}>
                  {quote.currency} {Number(metric.value).toFixed(2)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </PageBody>
  );
}
