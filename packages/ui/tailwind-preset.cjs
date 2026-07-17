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
        // Brand cobalt — actions, links, active states. 600 passes AA on white (6.0:1).
        brand: {
          50: "#eef4ff",
          100: "#dfe9ff",
          200: "#c5d6fe",
          300: "#a1bbfc",
          400: "#7b96f8",
          500: "#5472f1",
          600: "#2f54e3",
          700: "#2544c8",
          800: "#2239a1",
          900: "#21347f",
          950: "#131c4a",
        },
        // Near-black cool graphite for header/footer/dark CTAs.
        graphite: {
          800: "#1c2436",
          900: "#111827",
          950: "#0a1022",
        },
      },
      fontSize: {
        // Display sizes used on hero/landing headings only.
        "display-sm": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
        display: ["2.75rem", { lineHeight: "1.08", letterSpacing: "-0.03em" }],
        "display-lg": ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
      },
      boxShadow: {
        card: "0 1px 2px rgb(15 23 42 / 0.05), 0 1px 3px rgb(15 23 42 / 0.06)",
        "card-hover":
          "0 4px 12px rgb(15 23 42 / 0.08), 0 2px 4px rgb(15 23 42 / 0.05)",
        overlay: "0 16px 48px rgb(15 23 42 / 0.18), 0 4px 12px rgb(15 23 42 / 0.08)",
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
