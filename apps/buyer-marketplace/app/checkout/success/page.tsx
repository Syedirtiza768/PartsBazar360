"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { CheckCircleIcon, ReceiptIcon } from "@repo/ui/icons";
import { formatPrice } from "@/lib/format";
import {
  getStoredOrder,
  orderMoneyBreakdown,
  type StoredOrder,
} from "@/lib/order-history";
import {
  loadCheckoutAccountStatus,
  loadCheckoutToken,
  trackCheckoutEvent,
} from "@/lib/checkout-session";
import { useAuth } from "@/lib/auth-context";
import { API_BASE_URL } from "@/lib/api";

function SuccessContent() {
  const params = useSearchParams();
  const orderId = params.get("orderId");
  const provider = params.get("provider") === "tamara" ? "Tamara" : "Stripe";
  const checkoutSessionId = params.get("checkoutSessionId");
  const [order, setOrder] = useState<StoredOrder | null>(null);
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<
    "checking" | "paid" | "failed"
  >("checking");
  const { authHeaders, createCheckoutAccount } = useAuth();

  useEffect(() => {
    const stored = orderId ? getStoredOrder(orderId) : null;
    setOrder(stored);
    if (stored?.status === "PAID") setPaymentState("paid");
    if (stored?.status === "PAYMENT_FAILED") setPaymentState("failed");
    if (checkoutSessionId) {
      const status = loadCheckoutAccountStatus(checkoutSessionId);
      setAccountStatus(status);
    }
  }, [checkoutSessionId, orderId]);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const checkPayment = async () => {
      attempts += 1;
      try {
        const checkoutToken = checkoutSessionId
          ? loadCheckoutToken(checkoutSessionId)
          : null;
        const response = await fetch(
          `${API_BASE_URL}/checkout/orders/${encodeURIComponent(orderId)}`,
          {
            headers: {
              ...authHeaders(),
              ...(checkoutSessionId
                ? { "X-Checkout-Session": checkoutSessionId }
                : {}),
              ...(checkoutToken ? { "X-Checkout-Token": checkoutToken } : {}),
            },
            cache: "no-store",
          },
        );
        if (response.ok) {
          const current = (await response.json()) as { status?: string };
          if (cancelled) return;
          if (current.status === "PAID") {
            setPaymentState("paid");
            return;
          }
          if (current.status === "PAYMENT_FAILED") {
            setPaymentState("failed");
            return;
          }
        }
      } catch {
        // A transient status read must not replace the successful provider UI.
      }
      if (!cancelled && attempts < 15) {
        timer = setTimeout(() => void checkPayment(), 2000);
      }
    };

    void checkPayment();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authHeaders, checkoutSessionId, orderId]);

  useEffect(() => {
    if (
      paymentState === "paid" &&
      accountStatus === "eligible" &&
      checkoutSessionId
    ) {
      void trackCheckoutEvent("account_creation_shown", checkoutSessionId);
    }
  }, [accountStatus, checkoutSessionId, paymentState]);

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!checkoutSessionId) return;
    const token = loadCheckoutToken(checkoutSessionId);
    if (!token) {
      setAccountError(
        "This secure checkout session has expired. Your order is still complete.",
      );
      return;
    }
    setAccountSubmitting(true);
    setAccountError(null);
    try {
      const user = await createCheckoutAccount(
        checkoutSessionId,
        token,
        password,
      );
      setAccountStatus("created");
      setAccountMessage(
        user
          ? "Your account is ready and you are signed in."
          : "This order is already linked to your existing account.",
      );
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Account creation failed.",
      );
    } finally {
      setAccountSubmitting(false);
    }
  };

  const breakdown = order ? orderMoneyBreakdown(order) : null;

  return (
    <div className="mx-auto max-w-2xl gutter py-12 sm:py-16">
      <div className="text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircleIcon className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {paymentState === "paid" ? "Order confirmed" : "Payment submitted"}
        </h1>
        <p className="mt-2 text-graphite-600">
          {paymentState === "paid"
            ? `${provider} confirmed your payment. Sellers can now prepare your order.`
            : paymentState === "failed"
              ? `${provider} could not confirm this payment. Your cart and checkout details are still saved.`
              : `${provider} handled your payment securely. We are confirming it now; this usually takes only a moment.`}
        </p>
        {paymentState === "checking" && (
          <p className="mt-2 text-sm font-medium text-brand-700" role="status">
            Confirming payment…
          </p>
        )}
      </div>

      {orderId && (
        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ReceiptIcon className="h-4 w-4 text-slate-400" />
              Order reference
            </p>
          </div>
          <p className="part-number px-5 py-4 text-sm text-slate-900">
            {orderId}
          </p>
          {breakdown && order && (
            <dl className="space-y-2 border-t border-slate-100 px-5 py-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-graphite-600">Items</dt>
                <dd className="price text-sm">
                  {formatPrice(breakdown.itemsSubtotal, order.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-graphite-600">Shipping</dt>
                <dd className="price text-sm">
                  {formatPrice(breakdown.shippingTotal, order.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-base">
                <dt className="font-semibold text-slate-900">Total paid</dt>
                <dd className="price">
                  {formatPrice(breakdown.totalAmount, order.currency)}
                </dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {paymentState === "paid" &&
        accountStatus === "eligible" &&
        !accountMessage && (
          <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <h2 className="text-lg font-bold text-slate-950">
              Want faster checkout next time?
            </h2>
            <p className="mt-1 text-sm text-graphite-600">
              Create an account to view all your orders, track deliveries, and
              save time. Your order is already complete.
            </p>
            <form onSubmit={createAccount} className="mt-5 space-y-4">
              <div className="relative">
                <Input
                  label="Create password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  hint="Use at least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  className="absolute right-3 top-9 text-xs font-semibold text-brand-700"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {accountError && (
                <p className="text-sm font-medium text-red-600" role="alert">
                  {accountError}
                </p>
              )}
              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={accountSubmitting}
              >
                Create my account
              </Button>
              <button
                type="button"
                onClick={() => {
                  setAccountStatus("skipped");
                  void trackCheckoutEvent(
                    "account_creation_skipped",
                    checkoutSessionId ?? undefined,
                  );
                }}
                className="block w-full text-center text-sm font-semibold text-graphite-600"
              >
                Maybe later
              </button>
            </form>
          </section>
        )}

      {paymentState === "paid" && accountStatus === "existing" && (
        <p className="mt-8 rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-800">
          This order has been added to your purchase history. Sign in whenever
          you want to view it.
        </p>
      )}

      {accountMessage && (
        <p className="mt-8 rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-800">
          {accountMessage}
        </p>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {paymentState === "failed" ? (
          <Link href="/checkout" className={buttonClasses()}>
            Try payment again
          </Link>
        ) : (
          <Link href="/search" className={buttonClasses()}>
            Continue shopping
          </Link>
        )}
        {orderId && (
          <Link
            href={`/account/purchases/${encodeURIComponent(orderId)}`}
            className={buttonClasses({ variant: "outline" })}
          >
            View purchase
          </Link>
        )}
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="gutter py-16 text-center text-sm text-graphite-600">
          Loading…
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
