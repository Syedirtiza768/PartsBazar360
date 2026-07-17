/* global module, require */
/** @type {import('tailwindcss').Config} */
module.exports = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presets: [require("@repo/ui/tailwind-preset.cjs")],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
