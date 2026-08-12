import type { Metadata, Viewport } from "next";
import Script from "next/script";
import localFont from "next/font/local";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import { GarageProvider } from "@/lib/garage-context";
import { ToastProvider } from "@/lib/toast-context";
import { WatchlistProvider } from "@/lib/watchlist-context";
import { AuthProvider } from "@/lib/auth-context";
import { CurrencyProvider } from "@/lib/currency-context";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { INTERNAL_API_URL } from "@/lib/api";
import { absoluteUrl, getSiteUrl, INDEX_ROBOTS } from "@/lib/seo";
import type { FacetsResponse } from "@/lib/types";

/**
 * Self-hosted so the type system is deterministic on every device and the
 * build never depends on the network. Both are latin-subset variable files
 * (one file spans the whole weight range) from Google Fonts, SIL OFL 1.1.
 *
 * This replaces a stack that named `Inter` and `Arial Narrow` but loaded
 * neither: it resolved to Arial Narrow on Windows, Roboto Condensed on
 * Android, and — because iOS ships neither — plain San Francisco on iPhone,
 * silently dropping the condensed display type for iOS traffic.
 *
 * `display: swap` + `adjustFontFallback` keep text visible during load and
 * limit the layout shift when the real face arrives.
 */
const sans = localFont({
  src: "./fonts/Inter-latin-var.woff2",
  weight: "400 800",
  style: "normal",
  variable: "--font-sans",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

const display = localFont({
  src: "./fonts/RobotoCondensed-latin-var.woff2",
  weight: "400 900",
  style: "normal",
  variable: "--font-display",
  display: "swap",
  // Narrow faces are the fallback most likely to be missing, so name the
  // platform condensed faces before the generic stack.
  fallback: ["Arial Narrow", "ui-sans-serif", "system-ui", "sans-serif"],
});

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "PartsBazar360 | Exact-fit parts from marketplace sellers",
    template: "%s",
  },
  description:
    "Search new, used and OEM automotive parts by vehicle, part number or category with visible fitment evidence and seller terms.",
  alternates: { canonical: absoluteUrl("/") },
  verification: {
    google: "d6ZMoEJKI-bpEj4mmvDKIGkSi0rVs68Kx-PkpLJHGNk",
  },
  openGraph: {
    siteName: "PartsBazar360",
    type: "website",
    url: absoluteUrl("/"),
    images: [
      {
        url: absoluteUrl("/og.png"),
        width: 1728,
        height: 906,
        alt: "PartsBazar360 — Find the part. Verify the fit. Know the seller.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: [absoluteUrl("/og.png")],
  },
  robots: INDEX_ROBOTS,
};

/**
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` report real
 * values — without it iOS letterboxes the page and every safe-area utility in
 * the design system silently resolves to 0, so the sticky buy bar sits under
 * the home indicator.
 *
 * `maximumScale` and `userScalable` are deliberately left at their defaults:
 * capping zoom is a WCAG 1.4.4 failure, and the iOS focus-zoom problem it is
 * usually used to paper over is solved properly by the 16px control floor in
 * the preset.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2ed" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1519" },
  ],
};

// Broad category-group facets power the header nav rail + "Browse systems"
// quick list — those are department-level ("Transmission", "Electrical"),
// not the granular categories within them. Cached briefly so the header
// doesn't hit the API on every request.
async function getNavCategories(): Promise<FacetsResponse["categories"]> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/facets`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data: FacetsResponse = await res.json();
    return (data.categoryGroups ?? []).map(({ name, count }) => ({ name, count }));
  } catch {
    return [];
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const categories = await getNavCategories();

  return (
    <html
      lang="en"
      dir="ltr"
      data-scroll-behavior="smooth"
      className={`${sans.variable} ${display.variable}`}
    >
      <Script id="gtm" strategy="afterInteractive">{`
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','GTM-N373KFW3');
      `}</Script>
      <Script id="meta-pixel" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
        s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
        (window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '873024462353915');
        fbq('track', 'PageView');
      `}</Script>
      {/* min-h-dvh, not min-h-screen: `100vh` on mobile Safari is the *largest*
          viewport, so a min-h-screen column leaves a scroll gap the height of
          the retracted toolbar under every short page. */}
      <body className="flex min-h-dvh flex-col">
        <noscript>
          <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N373KFW3" height="0" width="0" style={{ display: "none", visibility: "hidden" }} />
          {/* eslint-disable-next-line @next/next/no-img-element -- Meta Pixel requires this exact noscript image. */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=873024462353915&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": `${siteUrl}/#organization`,
                  name: "PartsBazar360",
                  url: absoluteUrl("/"),
                  logo: absoluteUrl("/og.png"),
                  description:
                    "Motor parts marketplace focused on fitment evidence, condition disclosure, and seller-visible terms.",
                },
                {
                  "@type": "WebSite",
                  "@id": `${siteUrl}/#website`,
                  name: "PartsBazar360",
                  url: absoluteUrl("/"),
                  publisher: { "@id": `${siteUrl}/#organization` },
                  potentialAction: {
                    "@type": "SearchAction",
                    target: {
                      "@type": "EntryPoint",
                      urlTemplate: `${getSiteUrl()}/search?q={search_term_string}`,
                    },
                    "query-input": "required name=search_term_string",
                  },
                },
              ],
            }),
          }}
        />
        <a href="#main-content" className="skip-link">Skip to marketplace content</a>
        <ToastProvider>
          <AuthProvider>
            <CurrencyProvider>
              <GarageProvider>
                <WatchlistProvider>
                  <CartProvider>
                    <Header categories={categories} />
                    <main id="main-content" className="flex-1">
                      {children}
                    </main>
                    <Footer />
                    <WhatsAppButton />
                  </CartProvider>
                </WatchlistProvider>
              </GarageProvider>
            </CurrencyProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
