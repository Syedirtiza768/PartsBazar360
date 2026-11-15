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
      { type: "pb-ad-event", event, path, config: consent.config },
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
  void advertisingStatus()
    .then((status) => {
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
