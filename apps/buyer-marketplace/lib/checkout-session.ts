import { API_BASE_URL } from "./api";

const STATE_PREFIX = "pb360_checkout_state_v2:";
const TOKEN_PREFIX = "pb360_checkout_token_v2:";
const ACCOUNT_STATUS_PREFIX = "pb360_checkout_account_v2:";

export type CheckoutDraft = {
  name: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  paymentProvider: "stripe" | "tamara";
};

export type SavedCheckoutState = {
  checkoutSessionId: string;
  idempotencyKey: string;
  phoneVerified: boolean;
  maskedPhone?: string;
  accountExists?: boolean;
  draft: CheckoutDraft;
};

async function responseError(response: Response) {
  try {
    const body = await response.json();
    if (Array.isArray(body.message)) return body.message.join(", ");
    if (typeof body.message === "string") return body.message;
  } catch {
    // Keep the safe fallback below.
  }
  return "Something went wrong. Your checkout details are still saved.";
}

export function loadCheckoutState(cartId: string): SavedCheckoutState | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(
      sessionStorage.getItem(`${STATE_PREFIX}${cartId}`) || "null",
    );
    return value?.checkoutSessionId && value?.draft ? value : null;
  } catch {
    return null;
  }
}

export function saveCheckoutState(cartId: string, state: SavedCheckoutState) {
  // Delivery/contact PII survives reloads but is not retained across browser
  // sessions. The server-backed CheckoutSession remains the durable draft.
  sessionStorage.setItem(`${STATE_PREFIX}${cartId}`, JSON.stringify(state));
}

export function saveCheckoutToken(checkoutSessionId: string, token: string) {
  sessionStorage.setItem(`${TOKEN_PREFIX}${checkoutSessionId}`, token);
}

export function loadCheckoutToken(checkoutSessionId: string) {
  return sessionStorage.getItem(`${TOKEN_PREFIX}${checkoutSessionId}`);
}

export function saveCheckoutAccountStatus(
  checkoutSessionId: string,
  accountExists: boolean,
) {
  sessionStorage.setItem(
    `${ACCOUNT_STATUS_PREFIX}${checkoutSessionId}`,
    accountExists ? "existing" : "eligible",
  );
}

export function loadCheckoutAccountStatus(checkoutSessionId: string) {
  return sessionStorage.getItem(`${ACCOUNT_STATUS_PREFIX}${checkoutSessionId}`);
}

export async function createCheckoutSession(
  cartId: string,
  draft: CheckoutDraft,
) {
  const response = await fetch(`${API_BASE_URL}/checkout/${cartId}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return (await response.json()) as { checkoutSessionId: string };
}

export async function persistCheckoutDraft(
  checkoutSessionId: string,
  draft: CheckoutDraft,
) {
  const response = await fetch(
    `${API_BASE_URL}/checkout/sessions/${checkoutSessionId}/draft`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    },
  );
  if (!response.ok) throw new Error(await responseError(response));
}

export async function requestCheckoutOtp(
  checkoutSessionId: string,
  phone: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/checkout/sessions/${checkoutSessionId}/phone/send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    },
  );
  if (!response.ok) throw new Error(await responseError(response));
  return (await response.json()) as {
    sent: true;
    maskedPhone: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  };
}

export async function verifyCheckoutOtp(
  checkoutSessionId: string,
  code: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/checkout/sessions/${checkoutSessionId}/phone/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    },
  );
  if (!response.ok) throw new Error(await responseError(response));
  return (await response.json()) as {
    verified: true;
    checkoutToken: string;
    tokenExpiresAt: string;
    maskedPhone: string;
    accountExists: boolean;
  };
}

export function checkoutHeaders(state: SavedCheckoutState): HeadersInit {
  const token = loadCheckoutToken(state.checkoutSessionId);
  return {
    "X-Checkout-Session": state.checkoutSessionId,
    ...(token ? { "X-Checkout-Token": token } : {}),
    "Idempotency-Key": state.idempotencyKey,
  };
}

export async function trackCheckoutEvent(
  name: string,
  checkoutSessionId?: string,
  metadata?: Record<string, string | number | boolean>,
) {
  try {
    await fetch(`${API_BASE_URL}/checkout/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        name,
        checkoutSessionId,
        metadata,
        deviceClass: window.matchMedia("(max-width: 767px)").matches
          ? "mobile"
          : "desktop",
      }),
    });
  } catch {
    // Analytics must never interrupt checkout.
  }
}
