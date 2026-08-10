import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Shell";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "PartsBazar360 | Workshop",
  description: "Tools for repair workshops and installers.",
};

/** See the buyer app's layout for why `viewportFit: "cover"` is required. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <Script id="gtm" strategy="afterInteractive">{`
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','GTM-N373KFW3');
      `}</Script>
      <body
        className={`${inter.className} min-h-dvh bg-zinc-950 text-zinc-100 antialiased selection:bg-purple-500/30`}
      >
        <noscript>
          <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N373KFW3" height="0" width="0" style={{ display: "none", visibility: "hidden" }} />
        </noscript>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
