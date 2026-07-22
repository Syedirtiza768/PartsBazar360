import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import { GarageProvider } from "@/lib/garage-context";
import { ToastProvider } from "@/lib/toast-context";
import { WatchlistProvider } from "@/lib/watchlist-context";
import { AuthProvider } from "@/lib/auth-context";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { INTERNAL_API_URL, SITE_URL } from "@/lib/api";
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "PartsBazar360 | Exact-fit parts from marketplace sellers",
    template: "%s",
  },
  description:
    "Search new, used and OEM automotive parts by vehicle, part number or category with visible fitment evidence and seller terms.",
  openGraph: {
    siteName: "PartsBazar360",
    type: "website",
    images: [
      {
        url: `${SITE_URL}/og.png`,
        width: 1728,
        height: 906,
        alt: "PartsBazar360 — Find the part. Verify the fit. Know the seller.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: [`${SITE_URL}/og.png`],
  },
  robots: {
    index: true,
    follow: true,
  },
};

// Category facets power the header rail + search dropdown; cached briefly so
// the header doesn't hit the API on every request.
async function getNavCategories(): Promise<FacetsResponse["categories"]> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/search/facets`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data: FacetsResponse = await res.json();
    return data.categories ?? [];
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
      <body className="flex min-h-screen flex-col">
        <a href="#main-content" className="skip-link">Skip to marketplace content</a>
        <ToastProvider>
          <AuthProvider>
            <GarageProvider>
              <WatchlistProvider>
                <CartProvider>
                  <Header categories={categories} />
                  <main id="main-content" className="flex-1">
                    {children}
                  </main>
                  <Footer />
                </CartProvider>
              </WatchlistProvider>
            </GarageProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
