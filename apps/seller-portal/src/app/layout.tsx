import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import "./globals.css";
import { SellerAuthProvider } from "@/lib/auth-context";
import { Shell } from "@/components/Shell";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "PartsBazar360 | Seller Portal",
  description: "Manage your inventory, uploads, pricing, and orders.",
};

/** See the buyer app's layout for why `viewportFit: "cover"` is required. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <Script id="gtm" strategy="afterInteractive">{`
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','GTM-N373KFW3');
      `}</Script>
      <body className={`${inter.className} min-h-dvh bg-slate-50 text-graphite-700 antialiased`}>
        <noscript>
          <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N373KFW3" height="0" width="0" style={{ display: "none", visibility: "hidden" }} />
        </noscript>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <SellerAuthProvider>
          <Shell>{children}</Shell>
        </SellerAuthProvider>
      </body>
    </html>
  );
}
