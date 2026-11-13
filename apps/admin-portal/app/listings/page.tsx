"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PART_TYPES, PART_TYPE_LABELS } from "@repo/catalog-contracts";
import { Badge, type BadgeTone } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { Input, Select, Textarea } from "@repo/ui/field";
import { PageHeader } from "@repo/ui/page-header";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";

type Listing = {
  id: string;
  status: string;
  price: number;
  sellerBasePrice: number | null;
  currency: string;
  shippingCost: number | null;
  condition: string;
  partType: string;
  sellerSku: string | null;
  quantity: number;
  updatedAt: string;
  seller: { id: string; name: string };
  part: {
    id: string;
    slug: string | null;
    title: string;
    brand: string | null;
    manufacturerPartNumber: string | null;
    category: string | null;
    imageUrl: string | null;
    weightKg: number | null;
  };
};

type ListingPage = {
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  items: Listing[];
};

type Seller = { id: string; name: string };

const STATUSES = ["ACTIVE", "PAUSED", "OUT_OF_STOCK", "REVIEW"] as const;
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  OUT_OF_STOCK: "Out of stock",
  REVIEW: "In review",
};
const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: "success",
  PAUSED: "warning",
  OUT_OF_STOCK: "danger",
  REVIEW: "info",
};
const PAGE_SIZE = 25;

type NewListingForm = {
  sellerId: string;
  title: string;
  brand: string;
  manufacturerPartNumber: string;
  oeNumbers: string;
  category: string;
  partType: string;
  condition: string;
  price: string;
  currency: string;
  shippingCost: string;
  quantity: string;
  weightKg: string;
  sellerSku: string;
  description: string;
  status: string;
  imageUrls: string[];
};

const EMPTY_FORM: NewListingForm = {
  sellerId: "",
  title: "",
  brand: "",
  manufacturerPartNumber: "",
  oeNumbers: "",
  category: "",
  partType: "AFTERMARKET",
  condition: "NEW",
  price: "",
  currency: "USD",
  shippingCost: "",
  quantity: "1",
  weightKg: "",
  sellerSku: "",
  description: "",
  status: "ACTIVE",
  imageUrls: [],
};

async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (typeof body?.message === "string") return body.message;
  if (Array.isArray(body?.message)) return body.message.join(", ");
  return fallback;
}

/** External photos go through the same-origin proxy (hotlink protection); uploads are same-origin already. */
function imageSrc(url: string) {
  return /^https?:\/\//i.test(url) ? `/img-proxy/?url=${url}` : url;
}

function money(amount: number, currency: string) {
  return `${currency} ${amount.toFixed(2)}`;
}

/** Price + shipping editor for one listing row. */
function ListingRow({
  listing,
  token,
  onSaved,
}: {
  listing: Listing;
  token: string;
  onSaved: (listing: Listing) => void;
}) {
  const [price, setPrice] = useState(String(listing.price));
  const [shipping, setShipping] = useState(
    listing.shippingCost == null ? "" : String(listing.shippingCost),
  );
  const [status, setStatus] = useState(listing.status);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const priceNum = Number(price);
  const shippingValue = shipping.trim() === "" ? null : Number(shipping);
  const dirty =
    priceNum !== listing.price ||
    shippingValue !== listing.shippingCost ||
    status !== listing.status;

  async function save() {
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setNote({ ok: false, text: "Price must be above 0." });
      return;
    }
    if (shippingValue !== null && (!Number.isFinite(shippingValue) || shippingValue < 0)) {
      setNote({ ok: false, text: "Shipping must be 0 or more, or blank." });
      return;
    }
    const body: Record<string, unknown> = {};
    if (priceNum !== listing.price) body.price = priceNum;
    if (shippingValue !== listing.shippingCost) body.shippingCost = shippingValue;
    if (status !== listing.status) body.status = status;

    setSaving(true);
    setNote(null);
    try {
      const response = await apiFetch(
        token,
        `${API_BASE_URL}/admin/listings/${encodeURIComponent(listing.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not save listing."));
      }
      const saved = (await response.json()) as Listing;
      onSaved(saved);
      setNote({ ok: true, text: "Saved" });
      setTimeout(() => setNote(null), 2500);
    } catch (err) {
      setNote({
        ok: false,
        text: err instanceof Error ? err.message : "Could not save listing.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="flex min-w-0 gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {listing.part.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc(listing.part.imageUrl)}
              alt=""
              className="h-full w-full object-contain"
              loading="lazy"
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold text-slate-950">
            {listing.part.title}
          </p>
          <p className="mt-1 text-xs text-graphite-600">
            {[listing.part.brand, listing.part.manufacturerPartNumber, listing.sellerSku && `SKU ${listing.sellerSku}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-graphite-600">
            <Badge tone={STATUS_TONES[listing.status] ?? "neutral"} size="sm">
              {STATUS_LABELS[listing.status] ?? listing.status}
            </Badge>
            <span>{listing.seller.name}</span>
            <span>Qty {listing.quantity}</span>
            {listing.part.slug && (
              <a
                href={`/parts/${listing.part.slug}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                View on site
              </a>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8.5rem_8.5rem_9rem_auto] sm:items-end">
        <Input
          label={`Price (${listing.currency})`}
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        <Input
          label="Shipping (AED)"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="Calculated"
          value={shipping}
          onChange={(event) => setShipping(event.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-2">
          <Button onClick={save} loading={saving} disabled={!dirty || saving} size="md">
            Save
          </Button>
          {note && (
            <span
              role={note.ok ? "status" : "alert"}
              className={
                "text-xs font-medium " +
                (note.ok ? "text-emerald-700" : "text-red-700")
              }
            >
              {note.text}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function NewListingPanel({
  token,
  sellers,
  onCreated,
  onCancel,
}: {
  token: string;
  sellers: Seller[];
  onCreated: (listing: Listing) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<NewListingForm>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof NewListingForm>(key: K, value: NewListingForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    const room = 12 - form.imageUrls.length;
    const chosen = Array.from(files).slice(0, Math.min(8, room));
    if (chosen.length === 0) {
      setError("A listing can have up to 12 photos.");
      return;
    }
    const tooBig = chosen.find((file) => file.size > 8 * 1024 * 1024);
    if (tooBig) {
      setError(`${tooBig.name} is larger than 8 MB.`);
      return;
    }
    const data = new FormData();
    chosen.forEach((file) => data.append("files", file));
    setUploading(true);
    setError(null);
    try {
      const response = await apiFetch(token, `${API_BASE_URL}/admin/listings/images`, {
        method: "POST",
        body: data,
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not upload photos."));
      }
      const body = (await response.json()) as { urls: string[] };
      setForm((current) => ({
        ...current,
        imageUrls: [...current.imageUrls, ...body.urls].slice(0, 12),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photos.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function movePhoto(index: number, delta: number) {
    setForm((current) => {
      const next = [...current.imageUrls];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...current, imageUrls: next };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = Number(form.price);
    const quantity = Number(form.quantity);
    const shippingCost = form.shippingCost.trim() === "" ? null : Number(form.shippingCost);
    const weightKg = form.weightKg.trim() === "" ? undefined : Number(form.weightKg);
    if (!form.sellerId) return setError("Choose the seller this listing belongs to.");
    if (!form.title.trim()) return setError("Enter a title.");
    if (!Number.isFinite(price) || price <= 0) return setError("Enter a price above 0.");
    if (!Number.isInteger(quantity) || quantity < 0)
      return setError("Quantity must be a whole number, 0 or more.");
    if (shippingCost !== null && (!Number.isFinite(shippingCost) || shippingCost < 0))
      return setError("Shipping must be 0 or more, or left blank.");
    if (weightKg !== undefined && (!Number.isFinite(weightKg) || weightKg <= 0))
      return setError("Weight must be above 0 kg, or left blank.");

    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(token, `${API_BASE_URL}/admin/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellerId: form.sellerId,
          title: form.title,
          brand: form.brand || undefined,
          manufacturerPartNumber: form.manufacturerPartNumber || undefined,
          oeNumbers: form.oeNumbers || undefined,
          category: form.category || undefined,
          description: form.description || undefined,
          partType: form.partType,
          condition: form.condition,
          price,
          currency: form.currency,
          shippingCost,
          quantity,
          weightKg,
          sellerSku: form.sellerSku || undefined,
          status: form.status,
          imageUrls: form.imageUrls,
        }),
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not create listing."));
      }
      onCreated((await response.json()) as Listing);
      setForm({ ...EMPTY_FORM, sellerId: form.sellerId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create listing.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
    >
      <div>
        <h2 className="text-xl font-bold text-slate-950">New listing</h2>
        <p className="mt-1 text-sm text-graphite-600">
          Creates a catalog part and an offer for the chosen seller. It appears on
          the storefront as soon as it is saved as Active with stock.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Seller"
          required
          value={form.sellerId}
          onChange={(event) => set("sellerId", event.target.value)}
        >
          <option value="">Choose a seller</option>
          {sellers.map((seller) => (
            <option key={seller.id} value={seller.id}>
              {seller.name}
            </option>
          ))}
        </Select>
        <Select
          label="Status after saving"
          value={form.status}
          onChange={(event) => set("status", event.target.value)}
        >
          <option value="ACTIVE">Active (visible to buyers)</option>
          <option value="PAUSED">Paused (hidden)</option>
        </Select>
      </div>

      <Input
        label="Title"
        required
        maxLength={250}
        value={form.title}
        onChange={(event) => set("title", event.target.value)}
        placeholder="Front brake pad set for Toyota Land Cruiser 2016-2021"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Brand"
          value={form.brand}
          onChange={(event) => set("brand", event.target.value)}
          placeholder="Bosch"
        />
        <Input
          label="Part number (MPN)"
          value={form.manufacturerPartNumber}
          onChange={(event) => set("manufacturerPartNumber", event.target.value)}
        />
        <Input
          label="Seller SKU"
          value={form.sellerSku}
          onChange={(event) => set("sellerSku", event.target.value)}
          hint="Defaults to the part number."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="OE numbers"
          value={form.oeNumbers}
          onChange={(event) => set("oeNumbers", event.target.value)}
          hint="Separate with commas."
        />
        <Input
          label="Category"
          value={form.category}
          onChange={(event) => set("category", event.target.value)}
          placeholder="Brake Pads"
        />
        <Select
          label="Part type"
          value={form.partType}
          onChange={(event) => set("partType", event.target.value)}
        >
          {PART_TYPES.map((value) => (
            <option key={value} value={value}>
              {PART_TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="Condition"
          value={form.condition}
          onChange={(event) => set("condition", event.target.value)}
        >
          <option value="NEW">New</option>
          <option value="USED">Used</option>
          <option value="REFURBISHED">Refurbished</option>
        </Select>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <Input
            label="Price"
            required
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={form.price}
            onChange={(event) => set("price", event.target.value)}
          />
          <Select
            label="Currency"
            value={form.currency}
            onChange={(event) => set("currency", event.target.value)}
          >
            <option value="USD">USD</option>
            <option value="AED">AED</option>
          </Select>
        </div>
        <Input
          label="Shipping per item (AED)"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="Calculated"
          value={form.shippingCost}
          onChange={(event) => set("shippingCost", event.target.value)}
          hint="Blank = calculated from weight and destination. 0 = free."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Quantity in stock"
          required
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={form.quantity}
          onChange={(event) => set("quantity", event.target.value)}
        />
        <Input
          label="Weight (kg)"
          type="number"
          min="0.001"
          step="0.001"
          inputMode="decimal"
          value={form.weightKg}
          onChange={(event) => set("weightKg", event.target.value)}
          hint="Used for calculated shipping."
        />
      </div>

      <Textarea
        label="Description"
        maxLength={5000}
        value={form.description}
        onChange={(event) => set("description", event.target.value)}
      />

      <div>
        <p className="text-sm font-semibold text-slate-900">Photos</p>
        <p className="mt-1 text-xs text-graphite-600">
          JPEG, PNG or WebP, up to 8 MB each and 12 per listing. The first photo is the main image.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {form.imageUrls.map((url, index) => (
            <div
              key={url}
              className="relative h-24 w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageSrc(url)} alt={`Photo ${index + 1}`} className="h-full w-full object-contain" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-white/90 text-xs">
                <button
                  type="button"
                  className="px-1.5 py-0.5 disabled:opacity-30"
                  onClick={() => movePhoto(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move photo ${index + 1} earlier`}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="px-1.5 py-0.5 font-medium text-red-700"
                  onClick={() =>
                    set(
                      "imageUrls",
                      form.imageUrls.filter((_, i) => i !== index),
                    )
                  }
                  aria-label={`Remove photo ${index + 1}`}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className="px-1.5 py-0.5 disabled:opacity-30"
                  onClick={() => movePhoto(index, 1)}
                  disabled={index === form.imageUrls.length - 1}
                  aria-label={`Move photo ${index + 1} later`}
                >
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          id="listing-photos"
          onChange={(event) => void uploadPhotos(event.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          loading={uploading}
          disabled={uploading || form.imageUrls.length >= 12}
          onClick={() => fileInput.current?.click()}
        >
          Add photos
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
        <Button type="submit" loading={saving} disabled={saving || uploading}>
          Create listing
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function ListingsPage() {
  const { token, user } = useAdminAuth();
  const isAdmin = user?.role === "ADMIN";
  const [data, setData] = useState<ListingPage | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [search, setSearch] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load(nextPage = page) {
    if (!token || !isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(PAGE_SIZE),
        status,
      });
      if (search.trim()) params.set("search", search.trim());
      if (sellerId) params.set("sellerId", sellerId);
      const response = await apiFetch(token, `${API_BASE_URL}/admin/listings?${params}`);
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not load listings."));
      }
      setData((await response.json()) as ListingPage);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load listings.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSellers() {
    if (!token || !isAdmin) return;
    try {
      const response = await apiFetch(token, `${API_BASE_URL}/operations/sellers/onboarding`);
      if (!response.ok) return;
      const body = await response.json().catch(() => []);
      if (!Array.isArray(body)) return;
      setSellers(
        body
          .filter((seller): seller is { id: string; name?: string | null } =>
            Boolean(seller && typeof seller.id === "string"),
          )
          .map((seller) => ({ id: seller.id, name: seller.name?.trim() || seller.id }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch {
      // The seller filter stays empty if the directory is unavailable.
    }
  }

  useEffect(() => {
    void load(1);
    void loadSellers();
    // Load once the admin session is ready; filters reload via the Search button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin]);

  function replaceListing(updated: Listing) {
    setData((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    );
  }

  if (user && !isAdmin) {
    return (
      <PageBody size="wide">
        <PageHeader
          eyebrow="Catalog"
          title="Listings"
          description="Listing management is restricted to platform administrators."
        />
      </PageBody>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Catalog"
        title="Listings"
        description="Find any seller's listing to change its price, shipping charge or status, or create a custom listing."
        actions={
          !creating && (
            <Button
              onClick={() => {
                setCreating(true);
                setMessage(null);
              }}
            >
              New listing
            </Button>
          )
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

      {creating && token && (
        <NewListingPanel
          token={token}
          sellers={sellers}
          onCancel={() => setCreating(false)}
          onCreated={(listing) => {
            setCreating(false);
            setMessage(
              `Created “${listing.part.title}” for ${listing.seller.name} at ${money(listing.price, listing.currency)}.`,
            );
            setData((current) =>
              current
                ? { ...current, total: current.total + 1, items: [listing, ...current.items] }
                : current,
            );
          }}
        />
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      >
        <Input
          label="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Title, part number, SKU or listing ID"
        />
        <Select label="Seller" value={sellerId} onChange={(event) => setSellerId(event.target.value)}>
          <option value="">All sellers</option>
          {sellers.map((seller) => (
            <option key={seller.id} value={seller.id}>
              {seller.name}
            </option>
          ))}
        </Select>
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="ALL">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
        <Button type="submit" loading={loading}>
          Search
        </Button>
      </form>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="font-bold text-slate-950">
            {data ? `${data.total.toLocaleString()} listings` : "Listings"}
          </h2>
          <p className="text-xs text-graphite-600">
            Shipping blank = calculated at checkout from weight and destination.
          </p>
        </div>
        {loading && !data && <p className="p-4 text-sm text-graphite-600">Loading listings...</p>}
        {data && data.items.length === 0 && (
          <p className="p-4 text-sm text-graphite-600">No listings match these filters.</p>
        )}
        {data && data.items.length > 0 && token && (
          <ul className="divide-y divide-slate-200">
            {data.items.map((listing) => (
              <ListingRow
                key={`${listing.id}:${listing.updatedAt}`}
                listing={listing}
                token={token}
                onSaved={replaceListing}
              />
            ))}
          </ul>
        )}
        {data && data.total > data.limit && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => void load(page - 1)}
            >
              Previous
            </Button>
            <span className="text-graphite-600">
              Page {page} of {totalPages.toLocaleString()}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!data.hasMore || loading}
              onClick={() => void load(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </section>
    </PageBody>
  );
}
