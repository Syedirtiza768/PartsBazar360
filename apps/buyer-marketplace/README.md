This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000/buyer](http://localhost:3000/buyer) with your browser to see the result — the app is served under a `/buyer` basePath, so `http://localhost:3000/` will 404.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Fonts

Type is self-hosted with [`next/font/local`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts), configured in `app/layout.tsx`:

| Role | Face | File |
|---|---|---|
| Body (`--font-sans`) | Inter, latin variable | `app/fonts/Inter-latin-var.woff2` |
| Display (`--font-display`) | Roboto Condensed, latin variable | `app/fonts/RobotoCondensed-latin-var.woff2` |

Both are SIL OFL 1.1, ~97KB combined, and committed to the repo — so the build never fetches fonts over the network and the rendered type is identical on every device.

**Do not name a font family in `globals.css` that isn't loaded here.** The stack previously named `Inter` and `Arial Narrow` while loading neither, which resolved differently on Windows, Android and iOS — iOS ships neither condensed face, so headings silently lost their condensed treatment for iPhone traffic. Adding Arabic later means adding an arabic-subset file to this same config.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
