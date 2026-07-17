# PartsBazar360 Design System

## Workshop Ledger direction

PartsBazar360 uses a precise, editorial visual language inspired by parts counters, workshop job cards, technical catalogs, and industrial labeling. The interface is automotive without relying on racing cliches, carbon fibre, decorative gears, neon gradients, glass effects, or dashboard graphics.

The system is designed around four ideas:

1. **Fitment before persuasion.** Vehicle context and compatibility evidence outrank promotional content.
2. **Seller accountability.** A third-party offer never looks like stock sold directly by PartsBazar360.
3. **Dense, calm evidence.** Part numbers, condition, price, seller, shipping, returns, and warranty remain scannable without hiding complexity.
4. **Uncertainty is a state.** Confirmed, inferred, unknown, and incompatible fitment states use different labels and explanations. Color is never the only signal.

## Visual tokens

The implementation source is `packages/ui/tailwind-preset.cjs` plus `apps/buyer-marketplace/app/globals.css`.

| Role | Token / value | Use |
|---|---|---|
| Workshop ink | `graphite.950` / `#0d1519` | Header, footer, primary editorial surfaces, dark actions |
| Petrol | `brand.600` / `#116b6b` | Links, active controls, fitment context, information hierarchy |
| Petrol light | `brand.50` / `#edf8f7` | Selected and informational backgrounds |
| Safety orange | `signal.500` / `#f36b21` | Vehicle rail, primary home search, critical wayfinding only |
| Canvas | `#f4f2ed` | Page background |
| Ledger surface | `#ebe8e1` / `#e9e5dc` | Technical rails and section contrast |
| White | `#ffffff` | Product, form, table, and evidence surfaces |
| Verified fit | Emerald scale | Confirmed compatibility and success |
| Verify required | Amber scale | Additional engine, VIN, or specification check |
| Does not fit | Red scale | Incompatibility, destructive actions, validation errors |
| Information | Sky / petrol scale | Neutral evidence and marketplace guidance |

## Typography

- Display: condensed system stack (`Arial Narrow`, `Roboto Condensed`, then the body stack), uppercase only for short product or section statements.
- Body: system sans stack; 14-16px in transactional surfaces.
- Prices: bold tabular figures.
- OE, VIN, marketplace, and order identifiers: monospace with deliberate tracking.
- Minimum caption size: 11px only for uppercase technical labels; explanatory copy remains 12px or larger.

## Spacing and layout

- Base unit: 4px.
- Main container: `max-w-[1440px]` with 16 / 24 / 32px responsive gutters.
- Dense transactional page spacing: 24-40px.
- Editorial home section spacing: 40-64px.
- Technical relationships use borders, rules, aligned columns, and tables instead of a card around every item.
- Desktop marketplace navigation is three-tiered: utility, search/actions, then vehicle/category context.
- Mobile keeps menu, logo, cart, search, selected vehicle, and horizontally scrollable categories available without nesting the primary discovery actions.

## Shape and elevation

- Technical and marketplace panels are square or minimally rounded.
- Form controls retain moderate radii for usability and consistency with shared primitives.
- Pills are reserved for compact statuses such as condition or fitment.
- Resting surfaces use a one-pixel border; shadows indicate floating overlays, drawers, or interactive product hover only.

## Component inventory

### Global marketplace

- Header with utility navigation, intelligent search overlay, mobile drawer, garage context, category rail, account, watchlist, and cart
- Footer with marketplace model, account paths, support paths, and buyer guidance
- Search autocomplete with recent searches, part-number hint, and category shortcuts
- Toasts, skeletons, empty states, error states, pagination, breadcrumbs, form primitives

### Vehicle and fitment

- Vehicle picker: make -> model -> generation -> engine/trim
- Device garage with multiple vehicles, nickname, VIN, active vehicle, switch, edit, and remove
- Persistent selected-vehicle rail
- Fitment badge: verified, likely, verify required, incompatible, universal, unavailable
- Listing fitment checker and searchable compatibility table with evidence source
- Cart and checkout compatibility recap

### Catalog and listing

- Category and brand entry grids
- Filter sidebar and mobile drawer
- Applied-filter summary and sort control
- Product card with image, watch action, condition, source, OE number, seller, price, and fitment
- Image gallery with thumbnails, zoom, keyboard control, and actual-item guidance
- Offer comparison, buy now, add to cart, contact seller, watchlist, seller terms, and technical specification table

### Purchase and post-purchase

- Seller-grouped cart and checkout
- Labeled delivery form, review step, fitment confirmation, and order confirmation
- Device-local purchase index backed by real checkout responses
- Order detail with seller shipments, item recap, delivery address, contact, and return actions
- Messages, returns/issues, settings, and account overview surfaces

### Seller portal

The seller portal consumes the same preset and shared primitives (`@repo/ui/*`), so both
apps move together when tokens change.

- Responsive shell: fixed sidebar with icons and `aria-current` active states ≥ lg,
  top bar + slide-in drawer below
- PageHeader (eyebrow / title / description / actions) and StatCard with loading state
- StatusBadge mapping backend statuses (orders, uploads, onboarding, offers) to badge tones
- Inventory table with explicit-save inline price editor (labeled input, save button,
  "Saved" confirmation, validation error) instead of silent on-blur commits
- Ship dialog (carrier select + tracking input with validation) replacing `window.prompt`
- Onboarding stepper with labeled Field primitives; uploads pipeline with drag-target file
  input, per-row approve actions, and job detail loading

## Interaction states

Every reusable control supports a relevant subset of default, hover, active, focus-visible, disabled, loading, error, empty, and success states. Dynamic actions announce outcomes through labeled status text or toasts. Motion is limited to fast drawers, overlays, search suggestions, gallery transitions, and feedback; reduced-motion preferences disable nonessential motion.

## Accessibility

- WCAG 2.2 AA-oriented color contrast and visible keyboard focus
- Skip link and semantic landmarks
- Labeled search, filter, checkout, support, and garage controls
- Keyboard-accessible menus, gallery, filter drawer, and dialogs
- Minimum 40px action targets; primary mobile actions are 44px or larger
- Status always includes text or an icon plus text
- Horizontal technical tables scroll inside their own container rather than the page
- 320px layouts are verified without document-level horizontal overflow
