/* global module, require */
/** @type {import('tailwindcss').Config} */
module.exports = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presets: [require("@repo/ui/tailwind-preset.cjs")],
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
