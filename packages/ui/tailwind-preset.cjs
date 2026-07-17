/**
 * PartsBazar360 design tokens — shared Tailwind preset.
 * Consumed by every app via `presets: [require("@repo/ui/tailwind-preset.cjs")]`.
 * See docs/DESIGN_SYSTEM.md for usage rules.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [],
  theme: {
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
      },
      fontSize: {
        // Display sizes used on hero/landing headings only.
        "display-sm": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
        display: ["2.75rem", { lineHeight: "1.08", letterSpacing: "-0.03em" }],
        "display-lg": ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
      },
      boxShadow: {
        card: "0 1px 0 rgb(13 21 25 / 0.08)",
        "card-hover":
          "0 8px 24px rgb(13 21 25 / 0.11), 0 1px 0 rgb(13 21 25 / 0.08)",
        overlay: "0 18px 50px rgb(13 21 25 / 0.22), 0 3px 10px rgb(13 21 25 / 0.10)",
        "top-bar": "0 -4px 16px rgb(15 23 42 / 0.08)",
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
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out both",
        "slide-up": "slide-up 250ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in-right": "slide-in-right 250ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in-left": "slide-in-left 250ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
