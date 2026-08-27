"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { Checkbox, Input } from "@repo/ui/field";
import { PageHeader } from "@repo/ui/page-header";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";

type Coupon = {
  id: string;
  code: string;
  discountPercent: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  orderCount: number;
};

type FormState = {
  code: string;
  discountPercent: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
};

const EMPTY: FormState = {
  code: "",
  discountPercent: "20",
  active: true,
  startsAt: "",
  endsAt: "",
};

function dateForInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return offsetDate.toISOString().slice(0, 16);
}

function toForm(coupon?: Coupon): FormState {
  return coupon
    ? {
        code: coupon.code,
        discountPercent: String(coupon.discountPercent),
        active: coupon.active,
        startsAt: dateForInput(coupon.startsAt),
        endsAt: dateForInput(coupon.endsAt),
      }
    : EMPTY;
}

function dateLabel(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "No limit";
}

function statusFor(coupon: Coupon): {
  label: string;
  tone: "success" | "warning" | "danger";
} {
  if (!coupon.active) return { label: "Disabled", tone: "danger" };
  const now = Date.now();
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) {
    return { label: "Scheduled", tone: "warning" };
  }
  if (coupon.endsAt && new Date(coupon.endsAt).getTime() <= now) {
    return { label: "Expired", tone: "danger" };
  }
  return { label: "Active", tone: "success" };
}

async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (typeof body?.message === "string") return body.message;
  if (Array.isArray(body?.message)) return body.message.join(", ");
  return fallback;
}

export default function CouponsPage() {
  const { token, user } = useAdminAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCoupons(selectId?: string | null) {
    if (!token || user?.role !== "ADMIN") return;
    setLoading(true);
    try {
      const response = await apiFetch(token, API_BASE_URL + "/admin/coupons");
      if (!response.ok) {
        throw new Error(
          await errorMessage(response, "Could not load coupons."),
        );
      }
      const data = (await response.json()) as Coupon[];
      const nextCoupons = Array.isArray(data) ? data : [];
      setCoupons(nextCoupons);
      const nextId = selectId || selectedId || nextCoupons[0]?.id || null;
      const next = nextCoupons.find((coupon) => coupon.id === nextId);
      if (next) {
        setSelectedId(next.id);
        setForm(toForm(next));
      } else {
        setSelectedId(null);
        setForm(EMPTY);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load coupons.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token && user?.role === "ADMIN") void loadCoupons();
    // loadCoupons intentionally stays local to this page so it uses the current token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.role]);

  function startNew() {
    setSelectedId(null);
    setForm(EMPTY);
    setMessage(null);
    setError(null);
  }

  function selectCoupon(coupon: Coupon) {
    setSelectedId(coupon.id);
    setForm(toForm(coupon));
    setMessage(null);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token || user?.role !== "ADMIN") return;

    const discountPercent = Number(form.discountPercent);
    if (
      !form.code.trim() ||
      !Number.isFinite(discountPercent) ||
      discountPercent < 0.01 ||
      discountPercent > 100
    ) {
      setError("Enter a coupon code and a discount between 0.01% and 100%.");
      return;
    }

    const startsAt = form.startsAt ? new Date(form.startsAt) : null;
    const endsAt = form.endsAt ? new Date(form.endsAt) : null;
    if (
      (startsAt && Number.isNaN(startsAt.getTime())) ||
      (endsAt && Number.isNaN(endsAt.getTime())) ||
      (startsAt && endsAt && startsAt >= endsAt)
    ) {
      setError("The start date must be before the end date.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await apiFetch(
        token,
        API_BASE_URL + "/admin/coupons" + (selectedId ? "/" + selectedId : ""),
        {
          method: selectedId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: form.code,
            discountPercent,
            active: form.active,
            startsAt: startsAt?.toISOString() ?? null,
            endsAt: endsAt?.toISOString() ?? null,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not save coupon."));
      }
      const saved = (await response.json()) as Coupon;
      setMessage(selectedId ? "Coupon changes saved." : "Coupon created.");
      await loadCoupons(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save coupon.");
    } finally {
      setSaving(false);
    }
  }

  if (user && user.role !== "ADMIN") {
    return (
      <PageBody size="wide">
        <PageHeader
          eyebrow="Promotion management"
          title="Coupons"
          description="Coupon management is restricted to platform administrators."
        />
      </PageBody>
    );
  }

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Promotion management"
        title="Coupons"
        description="Create percentage-off promotions, schedule their availability, and disable them without removing order history."
        actions={
          <Button onClick={startNew} variant="secondary">
            New coupon
          </Button>
        }
      />

      {message && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.7fr)]">
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold text-slate-950">Saved coupons</h2>
            <span className="text-xs text-graphite-600">{coupons.length}</span>
          </div>
          <div className="mt-4 space-y-2">
            {loading && (
              <p className="text-sm text-graphite-600">Loading coupons...</p>
            )}
            {!loading && coupons.length === 0 && (
              <p className="text-sm text-graphite-600">
                No coupons yet. Create the first promotion.
              </p>
            )}
            {coupons.map((coupon) => {
              const status = statusFor(coupon);
              return (
                <button
                  key={coupon.id}
                  type="button"
                  onClick={() => selectCoupon(coupon)}
                  aria-pressed={selectedId === coupon.id}
                  className={
                    "w-full rounded-lg border p-3 text-left transition-colors " +
                    (selectedId === coupon.id
                      ? "border-brand-500 bg-brand-50"
                      : "border-slate-200 hover:border-slate-300")
                  }
                >
                  <span className="block truncate text-sm font-semibold text-slate-950">
                    {coupon.code}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-graphite-600">
                    <Badge tone={status.tone} size="sm">
                      {status.label}
                    </Badge>
                    <span>{coupon.discountPercent}% off</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <form
          onSubmit={save}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
        >
          <div>
            <h2 className="text-xl font-bold text-slate-950">
              {selectedId ? "Edit coupon" : "New coupon"}
            </h2>
            <p className="mt-1 text-sm text-graphite-600">
              Discounts apply to the item subtotal only. Shipping is unchanged.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Coupon code"
              required
              value={form.code}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  code: event.target.value.toUpperCase(),
                }))
              }
              placeholder="SUMMER20"
              hint="Codes are stored and checked in uppercase."
            />
            <Input
              label="Discount percentage"
              required
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={form.discountPercent}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  discountPercent: event.target.value,
                }))
              }
              hint="Enter a value from 0.01 to 100."
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <Checkbox
              checked={form.active}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
              label="Coupon is enabled"
              description="Disabled coupons remain visible here and cannot be applied at checkout."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Starts at"
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  startsAt: event.target.value,
                }))
              }
              hint="Leave blank to start immediately."
            />
            <Input
              label="Ends at"
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  endsAt: event.target.value,
                }))
              }
              hint="Leave blank for no expiry."
            />
          </div>

          {selectedId && (
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite-600">
                  Redemption count
                </p>
                <p className="mt-1 font-semibold text-slate-900">
                  {coupons.find((coupon) => coupon.id === selectedId)
                    ?.orderCount ?? 0}{" "}
                  orders
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite-600">
                  Availability
                </p>
                <p className="mt-1 text-slate-700">
                  {dateLabel(
                    coupons.find((coupon) => coupon.id === selectedId)
                      ?.startsAt ?? null,
                  )}
                  {" → "}
                  {dateLabel(
                    coupons.find((coupon) => coupon.id === selectedId)
                      ?.endsAt ?? null,
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
            <Button type="submit" loading={saving}>
              {selectedId ? "Save changes" : "Create coupon"}
            </Button>
            {selectedId && (
              <Button
                type="button"
                variant="outline"
                onClick={startNew}
                disabled={saving}
              >
                New coupon
              </Button>
            )}
          </div>
        </form>
      </div>
    </PageBody>
  );
}
