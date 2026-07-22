## Initial three-seller marketplace

Default seed (`npm run seed:marketplace --workspace api`) provisions exactly:

| Seller | Listings source |
|--------|-----------------|
| **Salvage Auto Parts** | RealTrack US SalvageA (`salvagea` / `3b84b063-…`) only |
| **Blackline Auto Parts** | RealTrack `blacklineusedautoparts` (`d16199c4-…`) only |
| **Superior Auto Parts** | Spreadsheet uploads: FEBEST, DXB-EXW, Dynatrade |

Any other sellers are **SUSPENDED** and their offers set to **INACTIVE** (`SEED_DEACTIVATE_LEGACY_SELLERS=true` by default).

Cross-store assignment is rejected during ingestion. Image binaries are never downloaded; remote URLs are stored with eBay-hosted URLs sorted first.

### Auth users (seeded)

| Email | Role |
|-------|------|
| `admin@partsbazar360.com` | ADMIN (all stores) |
| `salvage.{owner\|manager\|staff}@partsbazar360.com` | Salvage Auto Parts |
| `blackline.{owner\|manager\|staff}@partsbazar360.com` | Blackline Auto Parts |
| `superior.{owner\|manager\|staff}@partsbazar360.com` | Superior Auto Parts |
| `buyer@partsbazar360.com` | BUYER |

Default password: `SEED_AUTH_PASSWORD` or `ChangeMe123!`.

Buyer endpoints: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`.

Buyer marketplace: `/login`, `/signup`. Checkout requires sign-in and redirects to **Stripe Checkout** (hosted — card data never touches our servers).

Admin portal: `/login` (ADMIN role only). Seeded admin works after marketplace seed.

Stripe sandbox env (API): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BUYER_APP_URL`. Webhook: `POST /checkout/webhooks/stripe` (`checkout.session.completed`).

Lightweight cleanup (no RealTrack/spreadsheet): `npm run seed:cleanup-auth --workspace api`.

Set `SEED_DYNATRADE_FILE` / `SEED_FEBEST_FILE` / `SEED_DXB_FILE` for Superior imports.
