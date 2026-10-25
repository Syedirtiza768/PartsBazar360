# @repo/ui

**Last reviewed:** 2026-10-25

Shared React component library used by all four Next.js apps ([[../apps/buyer-marketplace]], [[../apps/seller-portal]], [[../apps/admin-portal]], [[../apps/workshop-portal]]).

See [[../DESIGN_SYSTEM]] for the visual direction this library implements.

## AppShell brand
`AppShell` (`src/app-shell.tsx`) takes `brand` and `brandAccent` as text and an optional `logo` node. When `logo` is set it replaces the text in the rail and the drawer; the text stays as the fallback. Admin, seller and workshop pass the horizontal lockup from their own `public/brand/` folder, with their base path (`/admin/`, `/seller/`, `/workshop/`). The workshop rail is `tone="dark"`, so it uses the reversed lockup.

## Open questions / TODO
- Inventory the actual components once you're working in here (this note is a stub).
- Note which components are shared as-is vs. themed per-app.
