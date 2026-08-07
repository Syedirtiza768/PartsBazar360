# Guest-first checkout

**Last reviewed:** 2026-08-07

PartsBazar360 checkout treats a verified phone as a commerce identity, not as
an account login. Buying never requires a password.

## Customer journey

1. An active cart opens a `CheckoutSession` and records `checkout_started`.
2. The buyer enters a country-aware phone number and receives a six-digit SMS.
3. Successful OTP verification resolves one `Customer` by normalized E.164
   phone and returns a short-lived, checkout-scoped token.
4. Delivery and payment fields are progressively disclosed after verification.
5. One stable idempotency key creates at most one order for the checkout
   session. A failed payment creates another provider attempt on that order.
6. The cart remains active through declines/cancellation and is closed only by
   a successful payment webhook.
7. After payment, a customer without an account may create one with only a
   password. Existing account holders see that the order is already linked.

## Identity and authorization boundary

- `Customer` owns verified phone identity and order history.
- `User` remains the authentication/staff account and may link to one customer.
- `CheckoutSession` stores draft and transaction verification state.
- `PhoneVerificationChallenge` stores only an HMAC of the OTP, never the code.
- The checkout token is bound to one session/cart, expires after two hours, and
  cannot read profile data, saved addresses, settings, or unrelated orders.
- Full account tokens are issued only by login or explicit post-purchase
  account creation.

## OTP protections

- cryptographically secure six-digit codes;
- five-minute expiry and one-time consumption;
- five attempts per challenge;
- 45-second resend cooldown;
- rolling per-phone and per-IP send limits;
- generic pre-verification responses that do not reveal account existence;
- masked destinations and provider errors that preserve all checkout state;
- no OTP or provider response bodies in logs.

## Orders, payments, and inventory

`Order.customerId`, `verifiedPhone`, `checkoutSessionId`, and `idempotencyKey`
are durable identity/audit fields. The existing `buyerId` and `PaymentIntent`
remain during the compatibility window. `PaymentAttempt` records each hosted
provider session so cancellation/decline can retry the same order.

Contact and delivery drafts are server-backed and the browser cache uses
session storage, so a refresh is recoverable without retaining checkout PII
after the browser session ends. A failed payment releases its reservation;
retrying revalidates the unchanged cart and reserves inventory again before
creating another provider attempt.

Checkout re-reads offers, sellers, inventory, prices, currency, and shipping on
the server. Redis reservations account for other carts. A successful webhook
claims the payment transition atomically, decrements inventory once, advances
seller orders, closes the cart, and tolerates webhook replay.

## Migration and duplicate safety

The migration is additive and backfills only already-verified E.164 phones.
Build the API, then run `node apps/api/dist/src/audit-checkout-customers.cli.js`
before production rollout (or run the same compiled CLI in a one-off API
container attached to the application network).
The audit is read-only and reports invalid numbers, normalized collisions, and
verified users missing a customer identity. Never auto-merge two password
accounts; those collisions require manual review. For safe cases, prefer the
password account, then a verified row, then the oldest row, and repoint orders
transactionally before retiring duplicates.

## Analytics

`CheckoutEvent` accepts only an allowlist of funnel events and metadata keys.
Phone, email, address, name, OTP, token, and provider secrets are prohibited.
