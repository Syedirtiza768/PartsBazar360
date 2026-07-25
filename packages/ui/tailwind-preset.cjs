/* global module, require */
/**
 * PartsBazar360 design tokens — shared Tailwind preset.
 * Consumed by every app via `presets: [require("@repo/ui/tailwind-preset.cjs")]`.
 * See docs/DESIGN_SYSTEM.md for usage rules.
 *
 * This preset owns the *responsive foundations* for all five apps: the
 * breakpoint ladder, fluid display type, safe-area-aware spacing, the z-index
 * ladder, and a plugin that installs the shared base/utility rules (focus
 * rings, reduced motion, overflow guards, iOS input-zoom prevention, print).
 * Apps must not redefine any of these locally.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("tailwindcss/plugin");

/**
 * Safe-area insets. `safeFloor` wraps in max() so the value still applies on
 * devices that report 0 — it is a *floor*, not just a notch allowance.
 */
const inset = (side) => `env(safe-area-inset-${side}, 0px)`;
const safeFloor = (side, floor) => `max(${floor}, ${inset(side)})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [],
  theme: {
    /*
     * Defined (not extended) so the ladder stays in ascending order. Tailwind
     * appends `extend.screens` after the defaults, which would make `xs:`
     * utilities out-rank `2xl:` in the stylesheet — a silent, hard-to-find bug.
     *
     * xs (380px) separates the genuinely small handsets (320–375) from
     * standard ones; 3xl (1800px) keeps ultra-wide layouts from stretching.
     */
    screens: {
      xs: "380px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
      "3xl": "1800px",
    },
    extend: {
      colors: {
        // Brand petrol — actions, links, active states. 600 passes AA on white.
        brand: {
          50: "#edf8f7",
          100: "#d2efec",
          200: "#a9ded9",
          300: "#73c5bf",
          400: "#3ba49f",
          500: "#1f8582",
          600: "#116b6b",
          700: "#105656",
          800: "#114545",
          900: "#103a3b",
          950: "#062224",
        },
        // Near-black cool graphite for header/footer/dark CTAs.
        // 600/700 are the text ramp: both clear AA (4.5:1) on every ground we
        // ship — white, canvas #f4f2ed, and ledger #e9e5dc. Use these for text
        // rather than slate-400/500, which fail on the warmer surfaces
        // (slate-500 on #e9e5dc is 3.79:1).
        graphite: {
          600: "#4a5a63", // muted text — 7.16 white / 6.40 canvas / 5.69 ledger
          700: "#33434b", // body text — 10.27 white / 9.18 canvas
          800: "#273138",
          900: "#182229",
          950: "#0d1519", // headings, prices — 18.45 on white
        },
        // Safety orange. Carries graphite-950 text, never white: white on
        // signal-500 is 3.03:1. The scale crosses the contrast midpoint, so
        // dark text is only legible at 500/600 (6.09 / 4.59) and white only at
        // 700 (6.01). Buttons therefore stop at 600 — see the `vehicle`
        // variant in button.tsx.
        signal: {
          50: "#fff5ed",
          100: "#ffe6d3",
          500: "#f36b21",
          600: "#d95412",
          700: "#ad3f0e", // text-on-light only (7.31 on white); never a button ground
        },
        // Warm neutral grounds, previously hard-coded as raw hex in a dozen
        // files (#f4f2ed, #ebe8e1, #f7f6f2).
        canvas: {
          DEFAULT: "#f4f2ed", // page background
          sunk: "#ebe8e1", // category rail, inset strips
          raised: "#f7f6f2", // image wells
        },
      },
      fontSize: {
        /*
         * Fluid display type. The old fixed rem sizes put a 3.5rem (56px)
         * heading on a 320px screen, which wrapped to four lines and pushed the
         * hero CTA below the fold. clamp() lets one token read correctly from
         * 320px to 1920px without per-page overrides.
         */
        "display-sm": [
          "clamp(1.75rem, 1.34rem + 2.05vw, 2.25rem)",
          { lineHeight: "1.12", letterSpacing: "-0.025em" },
        ],
        display: [
          "clamp(2rem, 1.39rem + 3.05vw, 2.75rem)",
          { lineHeight: "1.08", letterSpacing: "-0.03em" },
        ],
        "display-lg": [
          "clamp(2.25rem, 1.23rem + 5.12vw, 3.5rem)",
          { lineHeight: "1.06", letterSpacing: "-0.03em" },
        ],
      },
      spacing: {
        // Raw insets — for offsetting fixed/sticky chrome.
        "safe-t": inset("top"),
        "safe-b": inset("bottom"),
        "safe-l": inset("left"),
        "safe-r": inset("right"),
        // Inset-or-floor — for padding that must never collapse to zero.
        "safe-b-3": safeFloor("bottom", "0.75rem"),
        "safe-b-4": safeFloor("bottom", "1rem"),
        "safe-b-6": safeFloor("bottom", "1.5rem"),
        // Standard touch target (44px) as a spacing token.
        touch: "2.75rem",
      },
      minWidth: { touch: "2.75rem" },
      minHeight: {
        touch: "2.75rem",
        // Dynamic viewport units: `min-h-screen` locks to the largest viewport
        // and leaves a gap under mobile browser chrome; dvh tracks it.
        dvh: "100dvh",
        svh: "100svh",
      },
      height: { dvh: "100dvh", svh: "100svh", lvh: "100lvh" },
      maxHeight: { dvh: "100dvh", svh: "100svh" },
      maxWidth: {
        // One content ladder for the whole platform. See <Container>.
        prose: "68ch",
        content: "80rem", // 1280 — reading-dense pages (cart, checkout, forms)
        wide: "90rem", // 1440 — marketplace grids, dashboards
        ultra: "108rem", // 1728 — the 3xl ceiling for full-bleed shells
      },
      /*
       * Named stacking ladder. Replaces the ad-hoc z-[60]/z-[70]/z-50 mix,
       * which let a filter drawer render *under* a sticky buy bar.
       */
      zIndex: {
        base: "0",
        sticky: "20",
        header: "40",
        dropdown: "50",
        drawer: "60",
        modal: "70",
        toast: "80",
        skip: "100",
      },
      boxShadow: {
        card: "0 1px 0 rgb(13 21 25 / 0.08)",
        "card-hover":
          "0 8px 24px rgb(13 21 25 / 0.11), 0 1px 0 rgb(13 21 25 / 0.08)",
        overlay: "0 18px 50px rgb(13 21 25 / 0.22), 0 3px 10px rgb(13 21 25 / 0.10)",
        "top-bar": "0 -4px 16px rgb(15 23 42 / 0.08)",
        // Horizontal-scroll affordance on responsive tables.
        "scroll-r": "inset -12px 0 12px -12px rgb(13 21 25 / 0.16)",
        "scroll-l": "inset 12px 0 12px -12px rgb(13 21 25 / 0.16)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        // Bottom-sheet entrance (mobile dialogs).
        "slide-in-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        // Centred dialog entrance (tablet and up).
        "scale-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out both",
        "slide-up": "slide-up 250ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in-right": "slide-in-right 250ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in-left": "slide-in-left 250ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in-up": "slide-in-up 260ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [
    plugin(({ addBase, addUtilities, addComponents, theme }) => {
      addBase({
        /*
         * Zoom on rotate, and text inflation on Android Chrome, both break
         * carefully sized layouts. Opt out of automatic inflation but keep the
         * user's own zoom working (we never set maximum-scale).
         */
        html: {
          "-webkit-text-size-adjust": "100%",
          "text-size-adjust": "100%",
        },
        /*
         * App-wide guard against unintended horizontal scroll. `clip` rather
         * than `hidden`: hidden turns the body into a scroll container, which
         * silently breaks every `position: sticky` header in the platform.
         * With overflow-x: clip, overflow-y stays `visible` per spec, so
         * sticky/scroll behaviour is untouched.
         *
         * This is a safety net, not a licence — overflowing content is still
         * fixed at the source so nothing is actually clipped off-screen.
         */
        body: {
          "overflow-x": "clip",
        },
        /*
         * iOS Safari zooms the viewport whenever a focused control renders
         * below 16px, and never zooms back out. Rather than forbidding small
         * type everywhere, force 16px on controls at phone widths only.
         *
         * Specificity note: these selectors are 0-1-1, so they out-rank the
         * `.text-sm` / `.text-xs` utilities (0-1-0) that would otherwise
         * reintroduce the zoom. Above `sm` the utilities take over again.
         */
        "@media (max-width: 639.98px)": {
          'input:not([type="checkbox"]):not([type="radio"]):not([type="range"])': {
            "font-size": "16px",
          },
          "select:not([hidden])": { "font-size": "16px" },
          "textarea:not([hidden])": { "font-size": "16px" },
        },
        /* Consistent, visible keyboard focus in every app. */
        ":focus-visible": {
          outline: "none",
          "box-shadow": `0 0 0 2px #fff, 0 0 0 4px ${theme("colors.brand.500")}`,
          "border-radius": theme("borderRadius.sm"),
        },
        "::selection": {
          "background-color": theme("colors.brand.100"),
          color: theme("colors.brand.900"),
        },
        "button, a, input, select, textarea": {
          "-webkit-tap-highlight-color": "transparent",
        },
        /*
         * Media never contributes to overflow, and never collapses before it
         * loads (a top source of cumulative layout shift).
         */
        "img, svg, video, canvas, iframe": {
          "max-width": "100%",
        },
        "img, video": {
          height: "auto",
        },
        /* Long identifiers (VIN, OE numbers, URLs) wrap instead of overflowing. */
        "th, td": {
          "overflow-wrap": "break-word",
        },
        "@media (prefers-reduced-motion: reduce)": {
          html: { "scroll-behavior": "auto" },
          "*, *::before, *::after": {
            "animation-duration": "0.01ms !important",
            "animation-iteration-count": "1 !important",
            "transition-duration": "0.01ms !important",
            "scroll-behavior": "auto !important",
          },
        },
        /* Print: drop app chrome, flatten decoration, keep the content. */
        "@media print": {
          body: { background: "#fff !important", color: "#000" },
          '[data-print="hide"]': { display: "none !important" },
          '[data-print="show"]': { display: "block !important" },
          "*": {
            "box-shadow": "none !important",
            "text-shadow": "none !important",
          },
          "table, figure, img": { "break-inside": "avoid" },
          "h1, h2, h3": { "break-after": "avoid" },
        },
      });

      addComponents({
        /* Prices and quantities align vertically in tables and cards. */
        ".price": {
          "font-weight": "700",
          "font-variant-numeric": "tabular-nums",
          "letter-spacing": "-0.015em",
          color: theme("colors.graphite.950"),
        },
        /* Part / OE / VIN / order identifiers. */
        ".part-number": {
          "font-family": theme("fontFamily.mono"),
          "font-size": "13px",
          "letter-spacing": "0.02em",
        },
        ".eyebrow": {
          "font-size": "11px",
          "font-weight": "900",
          "text-transform": "uppercase",
          "letter-spacing": "0.18em",
          color: theme("colors.brand.700"),
        },
        ".skip-link": {
          position: "fixed",
          left: "0.75rem",
          top: safeFloor("top", "0.75rem"),
          "z-index": theme("zIndex.skip"),
          transform: "translateY(-200%)",
          background: "#fff",
          padding: "0.75rem 1rem",
          "font-size": "0.875rem",
          "font-weight": "700",
          color: theme("colors.graphite.950"),
          "box-shadow": theme("boxShadow.overlay"),
          transition: "transform 150ms ease-out",
          "&:focus": { transform: "translateY(0)" },
        },
      });

      addUtilities({
        /*
         * The one horizontal gutter for the platform: 16 / 24 / 32px, each
         * floored against the landscape notch so content never slides under
         * the camera cutout when a phone is rotated.
         *
         * Every page container uses this via <Container>; nothing should hand-
         * roll `px-4 sm:px-6 lg:px-8` again.
         */
        ".gutter": {
          "padding-left": safeFloor("left", "1rem"),
          "padding-right": safeFloor("right", "1rem"),
          "@media (min-width: 640px)": {
            "padding-left": safeFloor("left", "1.5rem"),
            "padding-right": safeFloor("right", "1.5rem"),
          },
          "@media (min-width: 1024px)": {
            "padding-left": safeFloor("left", "2rem"),
            "padding-right": safeFloor("right", "2rem"),
          },
        },
        /* Same ladder as margin — for full-bleed children inside a gutter. */
        ".-gutter": {
          "margin-left": `calc(-1 * ${safeFloor("left", "1rem")})`,
          "margin-right": `calc(-1 * ${safeFloor("right", "1rem")})`,
          "@media (min-width: 640px)": {
            "margin-left": `calc(-1 * ${safeFloor("left", "1.5rem")})`,
            "margin-right": `calc(-1 * ${safeFloor("right", "1.5rem")})`,
          },
          "@media (min-width: 1024px)": {
            "margin-left": `calc(-1 * ${safeFloor("left", "2rem")})`,
            "margin-right": `calc(-1 * ${safeFloor("right", "2rem")})`,
          },
        },
        /*
         * Touch target floor. WCAG 2.2 AA (2.5.8) asks for 24px; Apple and
         * Material both ask for 44/48. We use 44 for anything a thumb hits.
         */
        ".touch-target": {
          "min-height": theme("spacing.touch"),
          "min-width": theme("spacing.touch"),
        },
        /*
         * Expands a small control's hit area without changing its visual size —
         * for icon buttons packed into dense toolbars where a 44px box would
         * blow up the layout.
         */
        ".touch-halo": {
          position: "relative",
          "&::after": {
            content: '""',
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            height: theme("spacing.touch"),
            width: theme("spacing.touch"),
          },
        },
        ".scrollbar-thin": {
          "scrollbar-width": "thin",
          "&::-webkit-scrollbar": { height: "6px", width: "6px" },
          "&::-webkit-scrollbar-thumb": {
            "border-radius": "9999px",
            "background-color": theme("colors.slate.300"),
          },
        },
        ".no-scrollbar": {
          "scrollbar-width": "none",
          "-ms-overflow-style": "none",
          "&::-webkit-scrollbar": { display: "none" },
        },
        /*
         * Horizontal rails (category chips, filter pills) that snap and stop
         * cleanly at the gutter.
         */
        ".scroll-rail": {
          display: "flex",
          "overflow-x": "auto",
          "overscroll-behavior-x": "contain",
          "-webkit-overflow-scrolling": "touch",
          "scroll-snap-type": "x proximity",
          "scrollbar-width": "none",
          "&::-webkit-scrollbar": { display: "none" },
          "& > *": { "scroll-snap-align": "start", "flex-shrink": "0" },
        },
        /* Long, unbreakable strings (OE numbers, emails, URLs, filenames). */
        ".break-anywhere": {
          "overflow-wrap": "anywhere",
          "word-break": "break-word",
        },
        ".text-balance": { "text-wrap": "balance" },
        ".text-pretty": { "text-wrap": "pretty" },
        /* Safe-area padding shorthands for fixed chrome. */
        ".pb-safe": { "padding-bottom": inset("bottom") },
        ".pt-safe": { "padding-top": inset("top") },
        ".px-safe": {
          "padding-left": inset("left"),
          "padding-right": inset("right"),
        },
        ".mb-safe": { "margin-bottom": inset("bottom") },
        /*
         * Keeps a scroll container from chaining its scroll to the page — the
         * fix for "the drawer scrolled and then the page scrolled behind it".
         */
        ".overscroll-none-y": { "overscroll-behavior-y": "contain" },
      });
    }),
  ],
};
