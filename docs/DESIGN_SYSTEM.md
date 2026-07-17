# PartsBazar360 Design System

Single source of truth: `packages/ui/tailwind-preset.cjs` (tokens) + `packages/ui/src/*` (primitives).
Both apps consume the preset via `presets: [require("@repo/ui/tailwind-preset.cjs")]` and import
primitives as `@repo/ui/<name>`.

## Principles

1. **Fitment is the hero.** The buyer's vehicle and whether a part fits it outrank every other
   piece of information. Fitment states have a dedicated, consistent visual language.
2. **Honest hierarchy.** Verified data looks verified; inferred data looks inferred. Uncertainty
   is labeled, never hidden or dressed up.
3. **Dense but calm.** Marketplace pages carry a lot of data; space is created with rhythm and
   grouping, not by hiding information.
4. **One accent per meaning.** Brand cobalt = action/interactive. Emerald = success/verified only.
   Amber = attention/vehicle context. Red = destructive/incompatible. Never decorative.

## Color

| Token | Value | Use |
|-------|-------|-----|
| `brand.600` `#2f54e3` | Primary actions, links, active states (6.0:1 on white) |
| `brand.700` `#2544c8` | Hover/pressed |
| `brand.50/100` | Tinted chips, selected backgrounds |
| `graphite.950` `#0a1022` | Header/footer surfaces, dark buy CTAs |
| `slate.*` | Neutrals: bg `slate-50`, surface white, border `slate-200`, muted text `slate-500`, body `slate-700`, headings `slate-900` |
| `emerald.*` | Success, verified fitment (text ≥ `emerald-700` on tints) |
| `amber.*` | Warnings, needs-verification fitment, vehicle-context accent (text ≥ `amber-800` on tints) |
| `red.*` | Errors, destructive, incompatible (text ≥ `red-700` on tints) |
| `sky.*` | Informational notes |

### Fitment state language (FitmentBadge)
| State | Visual | Copy |
|-------|--------|------|
| verified | emerald tint, shield-check icon | "Fits your {vehicle}" / "Verified fit" |
| likely | teal tint, check icon | "Likely fits — confirm engine/trim" |
| check | amber tint, alert icon | "Check fitment" |
| incompatible | red tint, x icon | "Doesn't fit your {vehicle}" |
| universal | slate tint, globe icon | "Universal part" |
| unknown | slate outline, help icon | "Fitment not verified" |

## Typography

Inter (existing). Scale: `display` 44–56/1.05/-0.03em (hero only) · `h1` 28–30 semibold ·
`h2` 20–22 semibold · `h3` 16–18 semibold · body 14–16 · caption 12 (minimum size).
Prices: `font-semibold tabular-nums`. Part/OE/VIN/order numbers: `font-mono text-[13px]`.

## Spacing & layout

4px base grid. Page container: `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8`.
Page vertical rhythm: `py-6 sm:py-8` (dense pages), `py-8 sm:py-12` (narrow/landing).
Card padding: `p-4` (compact) / `p-5 sm:p-6` (standard). Section gaps: `space-y-8/10`.
Breakpoints: Tailwind defaults; key layout switches at `sm` (640), `lg` (1024).

## Shape & elevation

Radii: badges/pills `rounded-full` · buttons/inputs `rounded-lg` · cards/panels `rounded-xl` ·
hero/modals `rounded-2xl`. Borders: `border-slate-200` (default), `border-slate-300` (inputs).
Shadows (cool-tinted, subtle): `shadow-card` resting · `shadow-card-hover` hover ·
`shadow-overlay` dialogs/drawers. Never stack heavy shadows; elevation expresses interactivity.

## Components (`@repo/ui/*`)

- `button` — primary / secondary / outline / ghost / danger / dark; sm / md / lg; `loading`,
  full-width; consistent focus ring (`focus-visible:ring-2 ring-brand-500 ring-offset-2`).
- `badge` — neutral / brand / success / warning / danger / info / outline tones, optional dot.
- `card` — surface + border + radius; `interactive` adds hover elevation.
- `field`/`input`/`select`/`textarea` — label, hint, error wiring with `aria-describedby`/`aria-invalid`.
- `skeleton` — shimmer block; compose per layout.
- `empty-state` — icon, title, description, action slot.
- `spinner` — inline loading.
- `icons` — typed 24×24 stroke-1.8 set shared by both apps.

App-level composites (buyer): FitmentBadge, ConditionBadge, Price, ProductCard(+Skeleton),
GarageChip, VehiclePicker, FilterSidebar/FilterDrawer, Pagination, BuyBox, ImageGallery,
CompatibilitySection, Toast, Breadcrumbs, QuantityStepper, StickyMobileBar.
Seller: Shell/Sidebar, PageHeader, StatCard, ShipDialog, table patterns.

## Interaction & motion

150ms ease-out for hover/press; 200–250ms for drawers/dialogs/toasts; `animate-fade-in`,
`animate-slide-up`, skeleton shimmer. Respect `prefers-reduced-motion` (preset disables
non-essential animation). No parallax, no decorative motion.

## States

Every async surface defines: loading (skeleton), empty (guidance + action), error (retry +
support path), success (confirmation + next step). Buttons expose disabled and loading.
Forms validate inline on blur/submit with error text tied via `aria-describedby`.

## Accessibility requirements

WCAG 2.1 AA contrast (all tokens above pass), visible `:focus-visible` rings on every
interactive element, skip-to-content link, labeled form controls, status conveyed by icon+text
(never color alone), touch targets ≥ 40px, logical heading order, `aria-current` for nav/pagination.

## Imagery

Product images on white/neutral `slate-50` tiles, `object-contain`, fixed square ratio.
Fallback placeholder icon on error. First gallery image should be the part itself —
document/datasheet photos are pushed later where detectable (multi-image listings).
