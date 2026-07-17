"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Button, buttonClasses } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import {
  CartIcon,
  TrashIcon,
  StoreIcon,
  TruckIcon,
  ShieldCheckIcon,
} from "@repo/ui/icons";
import { useCart, type CartItem } from "@/lib/cart-context";
import { formatPrice, humanize } from "@/lib/format";
import { PartImage } from "@/components/PartImage";
import { QuantityStepper } from "@/components/QuantityStepper";
import { CartLineFitment } from "@/components/CartLineFitment";

function CartLine({ item }: { item: CartItem }) {
  const { updateQuantity, removeItem, loading } = useCart();
  const part = item.sellerOffer.canonicalPart;
  const image = part?.imageUrls?.[0];

  return (
    <div className="flex gap-4 px-4 py-4 sm:px-5">
      <Link
        href={part ? `/part/${part.id}` : "#"}
        className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
      >
        <PartImage src={image} alt={part?.title || "Part"} className="object-contain p-1.5" />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={part ? `/part/${part.id}` : "#"}
              className="line-clamp-2 text-sm font-medium leading-snug text-slate-900 transition-colors hover:text-brand-600"
            >
              {part?.title || "Part"}
            </Link>
            <p className="mt-1 text-xs text-graphite-600">
              Condition: {humanize(item.sellerOffer.condition || "USED")}
            </p>
            <div className="mt-1.5">
              <CartLineFitment partId={part?.id} />
            </div>
          </div>
          <p className="price shrink-0 text-base">
            {formatPrice(item.sellerOffer.price * item.quantity, item.sellerOffer.currency)}
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <QuantityStepper
            quantity={item.quantity}
            disabled={loading}
            onChange={(next) => {
              if (next < 1) return;
              updateQuantity(item.id, next);
            }}
            label={`Quantity for ${part?.title || "part"}`}
          />
          <button
            type="button"
            onClick={() => removeItem(item.id)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-graphite-600 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <TrashIcon className="h-4 w-4" />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CartPage() {
  const { cart, subtotal, itemCount, loading } = useCart();
  const router = useRouter();
  const items = cart.items;
  const currency = items.find((i) => i.sellerOffer.currency)?.sellerOffer.currency ?? null;

  // Group lines by seller — orders ship per seller, and the cart should
  // set that expectation before checkout does.
  const sellerGroups = useMemo(() => {
    const groups = new Map<string, { name: string; items: CartItem[] }>();
    for (const item of items) {
      const key = item.sellerOffer.seller?.id || item.sellerOffer.seller?.name || "marketplace";
      const name = item.sellerOffer.seller?.name || "Marketplace seller";
      const group = groups.get(key) ?? { name, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [items]);

  const initialLoading = loading && items.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Your cart
        {itemCount > 0 && (
          <span className="ml-2 text-lg font-normal text-graphite-600">
            ({itemCount} item{itemCount === 1 ? "" : "s"})
          </span>
        )}
      </h1>

      {initialLoading ? (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]" aria-busy="true">
          <div className="space-y-4">
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-36 w-full rounded-xl" />
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            variant="page"
            icon={<CartIcon />}
            title="Your cart is empty"
            description="Find parts for your vehicle and they'll collect here, grouped by seller."
          >
            <Link href="/search" className={buttonClasses()}>
              Browse parts
            </Link>
            <Link href="/garage" className={buttonClasses({ variant: "outline" })}>
              Shop by vehicle
            </Link>
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_340px]">
          {/* Seller groups */}
          <div className="space-y-5">
            {sellerGroups.map((group) => (
              <section
                key={group.name}
                aria-label={`Items from ${group.name}`}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
              >
                <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
                    <StoreIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate">{group.name}</span>
                  </p>
                  <p className="flex shrink-0 items-center gap-1.5 text-xs text-graphite-600">
                    <TruckIcon className="h-3.5 w-3.5" />
                    Ships separately
                  </p>
                </header>
                <div className="divide-y divide-slate-100">
                  {group.items.map((item) => (
                    <CartLine key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Summary */}
          <aside className="lg:sticky lg:top-40" aria-label="Order summary">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
              <h2 className="text-base font-bold text-slate-900">Order summary</h2>
              <dl className="mt-4 space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-graphite-600">
                    Subtotal ({itemCount} item{itemCount === 1 ? "" : "s"})
                  </dt>
                  <dd className="price">{formatPrice(subtotal, currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-graphite-600">Shipping</dt>
                  <dd className="text-graphite-600">Calculated at checkout</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2.5 text-base">
                  <dt className="font-semibold text-slate-900">Estimated total</dt>
                  <dd className="price">{formatPrice(subtotal, currency)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-graphite-600">
                Weight-based shipping is added per seller shipment on the next step.
              </p>
              <Button
                fullWidth
                size="lg"
                className="mt-4"
                onClick={() => router.push("/checkout")}
                disabled={loading}
              >
                Continue to checkout
              </Button>
              <Link
                href="/search"
                className="mt-3 block text-center text-sm font-medium text-brand-600 transition-colors hover:text-brand-700"
              >
                Continue shopping
              </Link>
            </div>

            <ul className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Fitment and condition are shown per line — anything unverified is labeled, never
                hidden.
              </li>
              <li className="flex items-start gap-2">
                <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                Multi-seller orders arrive as separate shipments with their own tracking.
              </li>
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
