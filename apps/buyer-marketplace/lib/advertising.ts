"use client";

export type AdvertisingItem = {
  partId?: string;
  offerId?: string;
  name?: string;
  price: number;
  quantity: number;
};

export type AdvertisingEvent = {
  name:
    | "PageView"
    | "ViewContent"
    | "Search"
    | "AddToCart"
    | "InitiateCheckout"
    | "Purchase"
    | "AddToWishlist"
    | "Lead"
    | "Contact"
    | "EbayStoreClick";
  id: string;
  currency?: string;
  value?: number;
  items?: AdvertisingItem[];
  search?: string;
  contact?: "seller_message" | "whatsapp" | "phone";
};

/**
 * Advanced-matching identifiers: SHA-256 hex digests of vendor-normalized
 * customer details, computed in this window. Raw details never reach the
 * pixel frame. Mirrors `matchUser` in the API's advertising-payload.ts.
 */
type MatchUser = {
  em?: string;
  ph?: string;
  phE164?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  zp?: string;
  country?: string;
  external_id?: string;
};

export type AdvertisingCustomer = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  externalId?: string | null;
};

const matchKey = "pb_ad_user";
let matchUserData: MatchUser | undefined;
let hashing: Promise<void> | undefined;

if (typeof window !== "undefined") {
  try {
    const saved = JSON.parse(sessionStorage.getItem(matchKey) || "null");
    if (
      saved &&
      typeof saved === "object" &&
      Object.values(saved).every(
        (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
      )
    )
      matchUserData = saved as MatchUser;
  } catch {
    // Matching simply starts empty when session storage is unavailable.
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const letters = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}]/gu, "");

async function hashCustomer(details: AdvertisingCustomer) {
  const fields: Partial<Record<keyof MatchUser, string>> = {};
  const email = details.email?.trim().toLowerCase();
  if (
    email &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !email.endsWith("@guest.partsbazar360.com")
  )
    fields.em = email;
  const phone = details.phone?.trim();
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (phone && (phone.startsWith("+") || phone.startsWith("00")) && digits.length >= 8) {
    const national = phone.startsWith("00") ? digits.slice(2) : digits;
    fields.ph = national;
    fields.phE164 = "+" + national;
  }
  const named = (details.name ?? "").trim().split(/\s+/).map(letters).filter(Boolean);
  if (named.length) fields.fn = named[0];
  if (named.length > 1) fields.ln = named[named.length - 1];
  const city = letters(details.city ?? "");
  if (city) fields.ct = city;
  const zip = (details.postalCode ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (zip) fields.zp = zip;
  const country = details.country?.trim().toLowerCase();
  if (country && /^[a-z]{2}$/.test(country)) fields.country = country;
  const externalId = details.externalId?.trim();
  if (externalId) fields.external_id = externalId;
  const hashed: MatchUser = {};
  for (const [key, value] of Object.entries(fields) as Array<[keyof MatchUser, string]>) {
    hashed[key] = await sha256(value);
  }
  return hashed;
}

/**
 * Remember hashed customer details for advanced matching on later pixel
 * events in this browser session. Newer non-empty values replace older ones.
 */
export function setAdvertisingCustomer(details: AdvertisingCustomer) {
  if (typeof window === "undefined" || !crypto.subtle) return;
  const previous = hashing;
  hashing = (async () => {
    await previous;
    const hashed = await hashCustomer(details);
    if (!Object.keys(hashed).length) return;
    matchUserData = { ...matchUserData, ...hashed };
    try {
      sessionStorage.setItem(matchKey, JSON.stringify(matchUserData));
    } catch {
      // The in-memory copy still applies to this page.
    }
  })().catch(() => undefined);
}

function forgetAdvertisingCustomer() {
  matchUserData = undefined;
  try {
    sessionStorage.removeItem(matchKey);
  } catch {
    // Nothing persisted.
  }
}

type Destination = { catalogKey: "partId" | "offerId"; currencies: string[] };
type ConsentStatus = {
  enabled: boolean;
  granted: boolean;
  expiresAt?: string | null;
  config: { meta: Destination | null; tiktok: Destination | null };
};

const disabled: ConsentStatus = {
  enabled: false,
  granted: false,
  config: { meta: null, tiktok: null },
};
const consentUrl = "/api/advertising/consent";
const frameUrl = "/buyer/advertising-pixel-frame/";
const consentNotice = "pb_advertising_changed";
let consent: ConsentStatus | undefined;
let loading: Promise<ConsentStatus> | undefined;
let frame: HTMLIFrameElement | undefined;
let ready = false;
let pending: Array<{ event: AdvertisingEvent; path: string; once: boolean }> =
  [];
const seen = new Set<string>();
const observers = new Set<() => void>();

function hasConsent(status?: ConsentStatus) {
  return Boolean(
    status?.granted &&
    status.expiresAt &&
    Date.parse(status.expiresAt) > Date.now(),
  );
}

function syncConsent(result: ConsentStatus) {
  consent = result;
  if (!hasConsent(result)) {
    frame?.contentWindow?.postMessage(
      { type: "pb-ad-revoke" },
      location.origin,
    );
    frame?.remove();
    frame = undefined;
    ready = false;
    pending = [];
  } else {
    captureClickIds();
  }
  observers.forEach((notify) => notify());
  return result;
}

// Measurement is on by default; this first-party cookie records an explicit
// opt-out from the footer so the default grant is never re-applied.
const optOutCookie = "pb_ad_optout";

function optedOut() {
  return document.cookie
    .split(";")
    .some((part) => part.trim() === optOutCookie + "=1");
}

function rememberOptOut(value: boolean) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = value
    ? optOutCookie + "=1; Max-Age=31536000; Path=/; SameSite=Lax" + secure
    : optOutCookie + "=; Max-Age=0; Path=/; SameSite=Lax" + secure;
}

async function postConsent(granted: boolean) {
  const response = await fetch(consentUrl, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ granted }),
  });
  if (!response.ok)
    throw new Error("Could not save your preference. Please try again.");
  return (await response.json()) as ConsentStatus;
}

export function advertisingStatus(refresh = false) {
  if (!refresh && consent && (!consent.granted || hasConsent(consent))) {
    return Promise.resolve(consent);
  }
  loading ??= fetch(consentUrl, {
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) =>
      response.ok ? ((await response.json()) as ConsentStatus) : disabled,
    )
    .then(async (status) => {
      // Default grant: every visitor is measured unless they opted out.
      // Automated browsers are skipped so crawlers don't create grants.
      if (!status.enabled || hasConsent(status) || optedOut()) return status;
      if (navigator.webdriver) return status;
      return postConsent(true).catch(() => status);
    })
    .catch(() => disabled)
    .then(syncConsent)
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

export function observeAdvertisingConsent(notify: () => void) {
  observers.add(notify);
  return () => {
    observers.delete(notify);
  };
}

export async function updateAdvertisingConsent(granted: boolean) {
  await loading;
  rememberOptOut(!granted);
  if (!granted) {
    forgetAdvertisingCustomer();
    syncConsent({ ...(consent ?? disabled), granted: false });
    for (const key of ["pb_ad_fbc", "pb_ad_ttclid", "_fbp", "_fbc", "_ttp"]) {
      document.cookie = key + "=; Max-Age=0; Path=/; SameSite=Lax";
      if (location.hostname === "partsbazar360.com") {
        document.cookie =
          key +
          "=; Max-Age=0; Path=/; Domain=partsbazar360.com; SameSite=Lax; Secure";
      }
    }
  }
  const result = syncConsent(await postConsent(granted));
  try {
    localStorage.setItem(consentNotice, String(Date.now()));
  } catch {
    // Other tabs will recheck the server on focus.
  }
  return result;
}

export function captureClickIds() {
  if (!hasConsent(consent)) return;
  const current = new URL(location.href);
  const secure = current.protocol === "https:" ? "; Secure" : "";
  for (const [parameter, cookie] of [
    ["fbclid", "pb_ad_fbc"],
    ["ttclid", "pb_ad_ttclid"],
  ] as const) {
    const value = current.searchParams.get(parameter);
    if (value && /^[\w.-]{1,256}$/.test(value)) {
      const stored =
        parameter === "fbclid" ? "fb.1." + Date.now() + "." + value : value;
      document.cookie =
        cookie +
        "=" +
        stored +
        "; Max-Age=604800; Path=/; SameSite=Lax" +
        secure;
    }
  }
}

export function safeSearchTerm(term: string) {
  const value = term.trim().replace(/\s+/g, " ");
  // Prefer omission when a free-form search might contain a phone, email or VIN.
  if (
    !/^[\p{L}\d ._/-]{1,70}$/u.test(value) ||
    /\d{7}|\b[A-HJ-NPR-Z0-9]{17}\b/i.test(value) ||
    (/^[\d ./-]+$/.test(value) && value.replace(/\D/g, "").length >= 7)
  )
    return;
  return value;
}

function safePath(path: string) {
  // Product slug, query, account data and provider return state stay on the storefront.
  const sections = new Set([
    "account",
    "brands",
    "cart",
    "checkout",
    "contact",
    "garage",
    "part",
    "parts",
    "search",
    "support",
    "vehicles",
    "watchlist",
  ]);
  const [section, page] = path
    .replace(/^\/buyer(?=\/|$)/, "")
    .split("/")
    .filter(Boolean);
  if (section === "checkout" && page === "success")
    return "/buyer/checkout/success/";
  return section && sections.has(section)
    ? "/buyer/" + section + "/"
    : "/buyer/";
}

function mountFrame() {
  if (frame) return;
  const next = document.createElement("iframe");
  next.src = frameUrl;
  next.title = "Advertising measurement";
  next.hidden = true;
  next.referrerPolicy = "no-referrer";
  frame = next;
  document.body.append(next);
}

function flush() {
  if (!consent || !hasConsent(consent) || !frame?.contentWindow || !ready)
    return;
  for (const { event, path, once } of pending.splice(0)) {
    frame.contentWindow.postMessage(
      {
        type: "pb-ad-event",
        event,
        path,
        config: consent.config,
        user: matchUserData,
      },
      location.origin,
    );
    if (once) {
      try {
        localStorage.setItem("pb_ad_sent:" + event.id, "1");
      } catch {
        // The in-memory guard still applies when browser storage is restricted.
      }
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === consentNotice) void advertisingStatus(true);
  });
  window.addEventListener("focus", () => void advertisingStatus(true));
  window.addEventListener("message", (message) => {
    if (
      message.origin !== location.origin ||
      message.source !== frame?.contentWindow ||
      message.data?.type !== "pb-ad-ready"
    )
      return;
    ready = true;
    flush();
  });
}

export function trackAdvertising(
  event: AdvertisingEvent,
  options: { once?: boolean; key?: string } = {},
) {
  if (typeof window === "undefined") return;
  const path = safePath(location.pathname);
  // Wait for any in-flight customer hashing so this event carries it.
  void Promise.all([advertisingStatus(), hashing])
    .then(([status]) => {
      if (!hasConsent(status) || !hasConsent(consent)) return;
      const key = options.key ?? event.id;
      if (seen.has(key)) return;
      if (options.once) {
        try {
          if (localStorage.getItem("pb_ad_sent:" + event.id)) return;
        } catch {
          // Continue with the in-memory guard.
        }
      }
      if (seen.size > 500) seen.clear();
      seen.add(key);
      if (pending.length > 100) pending.shift();
      pending.push({ event, path, once: Boolean(options.once) });
      mountFrame();
      flush();
    })
    .catch(() => undefined);
}

export function trackAdvertisingClick(
  name: "Contact" | "EbayStoreClick",
  contact?: "whatsapp" | "phone",
) {
  if (!hasConsent(consent)) return;
  trackAdvertising({ name, id: crypto.randomUUID(), contact });
}
