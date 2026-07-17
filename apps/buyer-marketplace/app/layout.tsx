import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import { GarageProvider } from "@/lib/garage-context";
import { ToastProvider } from "@/lib/toast-context";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { INTERNAL_API_URL, SITE_URL } from "@/lib/api";
import type { FacetsResponse } from "@/lib/types";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "PartsBazar360 | Fitment-Verified Auto Parts Marketplace",
    template: "%s",
  },
  description:
    "Find the exact used & OEM auto parts that fit your vehicle, sourced live from verified marketplace sellers worldwide.",
  openGraph: {
    siteName: "PartsBazar360",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
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
    <html lang="en">
      <body className={`${inter.className} flex min-h-screen flex-col`}>
        <ToastProvider>
          <GarageProvider>
            <CartProvider>
              <Header categories={categories} />
              <main id="main-content" className="flex-1">
                {children}
              </main>
              <Footer />
            </CartProvider>
          </GarageProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
