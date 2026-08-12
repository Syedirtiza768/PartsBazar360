# Guest-first checkout

**Last reviewed:** 2026-08-12

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
7. After payment, the customer receives best-effort order confirmation by
   email and SMS when contact channels are available.
8. A customer without an account may create one with only a
   password. Existing account holders see that the order is already linked.

The cart's country selector is a guest-accessible shipping estimate. At checkout,
the shipping-address country is the authoritative destination; changing it
automatically refreshes the quote before review and payment. This keeps an
estimate for one country from being used for an address in another country.

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
- no OTPs, credentials, destinations, or authorization data in logs; failed
  provider response bodies may be logged only after recursive redaction and a
  4 KB bound for SMS delivery diagnostics.

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

## Going live: sandbox → production payments

Both rails read their credentials from `process.env` at request time inside the
**api** and **worker** containers, so a cutover is an env change plus a
container *recreate* — no image rebuild, no frontend deploy. Stripe is used via
hosted Checkout Sessions, so there is no publishable key in the browser bundle
to rebuild either.

Run on the server and paste each value when prompted (nothing is echoed, and
shell history is disabled for the session):

```
bash ~/set-payment-keys.sh
```

It backs up `.env`, rewrites only the payment keys, flips `TAMARA_API_URL` to
`https://api.tamara.co`, recreates `api` + `worker` with `--no-deps` (so no
other container and no standalone job is disturbed), and prints a rollback
command.

**The one that bites:** `STRIPE_WEBHOOK_SECRET` is *not* transferable from
test mode. Create a webhook endpoint in Stripe's **live** dashboard pointing at
`https://partsbazar360.com/api/checkout/webhooks/stripe` and use the
`whsec_…` it issues. Reusing the sandbox secret makes every live webhook fail
signature verification — payments succeed at the card network but orders are
never marked paid, which looks like money vanishing.

Tamara's production notification endpoint is
`https://partsbazar360.com/api/checkout/webhooks/tamara`.

### Verifying with real money

`payment:test-product` creates a 1 AED purchasable item at
`/buyer/parts/payment-verification-item/`. It is flagged
`_hiddenFromCatalog`, so it never appears in browse, search, related products,
or any sitemap, and is `noindex` — see [[SEO_ARCHITECTURE]] §11c. Buy it with a
real card and a real Tamara plan to confirm the full round trip: session →
redirect → webhook → order marked paid. Refund afterwards from the respective
dashboard.

Take the offer down without deleting the order history:

```
docker compose exec api node dist/src/payment-test-product.cli.js --deactivate
```
