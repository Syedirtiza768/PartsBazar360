# Responsive system

How PartsBazar360 handles screen size, input type, and device chrome across all
five frontends. Read this before adding a page, a table, or an overlay.

The implementation lives in `packages/ui/tailwind-preset.cjs` (tokens, base
rules, utilities) and `packages/ui/src/*` (primitives). Apps must not
re-implement any of it locally.

---

## 1. Breakpoints

Defined — not extended — in the preset, so the ladder stays in ascending
source order. `extend.screens` appends *after* the defaults, which would make
`xs:` utilities out-rank `2xl:` in the emitted stylesheet.

| Token | Width | What it separates |
|---|---|---|
| `xs` | 380px | Genuinely small handsets (320–375) from standard ones |
| `sm` | 640px | Phone from large phone / small tablet |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Where portal sidebars appear and drawers retire |
| `xl` | 1280px | Desktop |
| `2xl` | 1536px | Large desktop |
| `3xl` | 1800px | Ultra-wide; adds grid columns rather than stretching |

`xs` exists because 320px and 390px are genuinely different design problems.
Two-up product grids, side-by-side buttons and inline form actions all collapse
to one column below `xs`.

## 2. Containers

One ladder, one gutter. Use `<Container>` / `<PageBody>` from
`@repo/ui/container` — never hand-roll `mx-auto max-w-… px-4 sm:px-6 lg:px-8`.

| Size | Max width | Use |
|---|---|---|
| `prose` | 68ch | Long-form copy, capped by characters not pixels |
| `narrow` | 48rem | Single-column forms, confirmations, auth |
| `content` | 80rem | Reading-dense pages: cart, checkout, settings, PDP |
| `wide` | 90rem | Marketplace grids, dashboards, tables, app chrome |
| `full` | none | Full-bleed bands that supply their own inner container |

Before this there were six competing widths (1440px, `7xl`, `6xl`, `5xl`,
`3xl`, `2xl`) and three gutter recipes, so the header, the search results and
the cart all lined up differently on the same screen.

### The `gutter` utility

`padding-inline: 16 / 24 / 32px`, each floored against the landscape notch:

```css
padding-left: max(1rem, env(safe-area-inset-left));
```

It is a floor, not just a notch allowance — the value still applies on devices
that report `0`.

## 3. Safe areas and device chrome

- `viewportFit: "cover"` is exported from **every** app's root layout. Without
  it iOS letterboxes the page and every `env(safe-area-inset-*)` resolves to
  `0`, silently disabling the whole safe-area system.
- `maximumScale` / `userScalable` are deliberately left at their defaults.
  Capping zoom is a WCAG 1.4.4 failure; the iOS focus-zoom problem it is
  normally used to paper over is solved properly in §5.
- Fixed bottom chrome uses `pb-safe-b-3` / `pb-safe-b-4` (inset-or-floor), so a
  sticky action bar never sits under the home indicator.
- Sticky top chrome uses `pt-safe`.
- Use `min-h-dvh`, not `min-h-screen`. `100vh` on mobile Safari is the
  *largest* viewport, so a `min-h-screen` column leaves a scroll gap the height
  of the retracted toolbar under every short page. Overlays cap against
  `dvh` for the same reason.

## 4. Overflow policy

`body { overflow-x: clip }` is set globally as a safety net.

`clip` rather than `hidden` is load-bearing: `hidden` turns the body into a
scroll container, which silently breaks every `position: sticky` header in the
platform. With `overflow-x: clip`, `overflow-y` stays `visible` per spec.

It is a net, not a licence — overflow is still fixed at the source. Long
identifiers (OE numbers, VINs, filenames, emails) use `break-anywhere`;
constrained labels use `truncate` or `line-clamp-*`; wide content scrolls
inside its own container.

## 5. Forms and the iOS zoom trap

iOS Safari zooms the whole viewport whenever a focused control renders below
16px — and never zooms back out, stranding the user mid-form at 1.3× with the
rest of the page off-screen.

Two layers handle it:

1. The `@repo/ui/field` primitives declare `text-base sm:text-sm`, so intent is
   visible at the call site.
2. The preset enforces a defensive 16px floor on `input` / `select` /
   `textarea` below `sm`. The selectors are specificity `0-1-1`, so they
   out-rank the `.text-sm` / `.text-xs` utilities that would otherwise
   reintroduce the zoom.

Also standard on text fields: `inputMode`, `autoComplete`, and
`autoCapitalize="none" autoCorrect="off" spellCheck={false}` on identifiers
(emails, part numbers, tracking numbers, store IDs) that autocorrect would
otherwise mangle into words.

Validation messages sit in the document flow — never in a tooltip or an
absolutely positioned bubble — so a drawer or a short viewport can never clip
them out of reach.

## 6. Touch targets

`min-h-touch` / `touch-target` = 44px. WCAG 2.2 AA (2.5.8) asks for 24px;
Apple and Material both ask for 44/48. We use 44 for anything a thumb hits.

Buttons clear 44px on phones and relax to denser desktop heights from `sm` up
(`min-h-touch sm:min-h-9`). A 36px "small" button is fine under a mouse and a
coin-flip under a thumb, so the compact height is opt-in *by viewport*, not by
the caller remembering.

`touch-halo` expands a control's hit area without changing its visual size —
for icon buttons in dense toolbars where a 44px box would blow up the layout.

Hover must never be the only affordance. Where a control is revealed on hover
(gallery arrows), it is also revealed on `focus-visible`, and hover-only hints
are gated behind `@media (hover: hover)` so touch users are not shown an
affordance that can never appear.

## 7. Overlays

Everything — nav drawers, filter panels, dialogs, confirmations — is built on
`<Sheet>` (`@repo/ui/sheet`). It is the single overlay primitive, so these
behaviours are inherited rather than re-implemented (and re-broken) per site:

- fits the **dynamic** viewport, so browser chrome can never clip footer actions
- header and footer stay pinned while only the body scrolls
- body scroll does not chain to the page behind it
- bottom padding clears the home indicator
- focus trap with Tab wrapping, plus focus restored to the trigger on close
- Escape closes; the scrim is `aria-hidden` and out of the tab order (it would
  otherwise be the first stop inside the trap, and its action is already on the
  labelled close button)
- iOS-safe scroll lock (`position: fixed` + offset restore — `overflow: hidden`
  alone does not hold the document scroller on iOS) with scrollbar-width
  compensation so desktop layouts do not jump sideways

`side="center"` is a bottom sheet on phones and a centred dialog from `sm` up —
the right default for confirmations and forms. `side="left" | "right"` are side
drawers for navigation and filters.

**Initial focus is set synchronously and again on the next frame.** The
synchronous call is not redundant: `requestAnimationFrame` does not fire while
the document is hidden, so a drawer opened in a backgrounded tab would
otherwise leave focus stranded on the page behind the scrim.

## 8. Tables

A wide desktop table squeezed into 320px is unreadable, and hiding columns
loses data. Pick per case:

**`<DataTable>`** — one set of column definitions renders two presentations: a
real `<table>` from the chosen breakpoint up, and a stacked card list below it
where each column becomes a labelled field. Nothing is dropped; `priority`
(`primary` / `secondary` / `detail`) only decides *where* a value lands in the
card. Row actions render in both.

**`<TableScroller>`** — keeps the table when the grid shape *is* the point
(the compatibility table's year / make / model / trim / engine is a comparison
grid; stacking it would destroy the scanning behaviour). It is a labelled
`role="region"` with `tabindex="0"`, because a region reachable only by wheel
or swipe is a WCAG failure, plus edge shadows as the visible affordance that
there is more sideways — without them a clipped table just looks like a table
with missing columns. Pin the identifier column with `sticky left-0` and
**opaque** row striping (a sticky cell over a translucent row shows the other
columns sliding underneath it).

## 9. Z-index

A named ladder replaces the ad-hoc `z-[60]` / `z-[70]` / `z-50` mix that let a
filter drawer render *under* a sticky buy bar:

`base` 0 · `sticky` 20 · `header` 40 · `dropdown` 50 · `drawer` 60 ·
`modal` 70 · `toast` 80 · `skip` 100

## 10. Typography

Display sizes are fluid `clamp()` tokens (`display-sm`, `display`,
`display-lg`). The old fixed rem sizes put a 56px heading on a 320px screen,
which wrapped to four lines and pushed the hero CTA below the fold. One token
now reads correctly from 320px to 1920px with no per-page overrides.

Use `text-balance` on headings and `text-pretty` on body copy.

## 11. Motion, print, and reduced motion

- `prefers-reduced-motion: reduce` is honoured globally from the preset (all
  five apps, not just the marketplace).
- Print rules ship in the preset: white ground, no shadows, `break-inside:
  avoid` on tables/figures/images, `break-after: avoid` on headings. Mark
  chrome with `data-print="hide"` and print-only content with
  `data-print="show"`.

## 12. Verification

The acceptance bar is *measured*, not eyeballed. The harness loads each route
in a same-origin iframe at a fixed width, then walks every rendered element
looking for boxes outside the viewport, ignoring anything inside a legitimate
horizontal scroll container.

Widths: 320 / 360 / 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920, plus
1680 / 2560 for ultra-wide, the landscape phone and tablet sizes, and the CSS
viewports a 200% browser zoom produces (512 / 640 / 720 / 960).

One caveat when writing such a harness: the preset's `iframe { max-width: 100% }`
base rule will silently cap the test frame at the parent viewport, so any
reading above the parent width is a lie unless the frame sets
`max-width: none`.
