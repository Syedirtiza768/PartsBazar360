import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AdminAuthProvider } from "@/lib/auth-context";
import { AdminShell } from "@/components/AdminShell";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "PartsBazar360 | Admin Console",
  description: "Platform administration for PartsBazar360.",
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
      <body className={`${inter.className} min-h-dvh bg-slate-50 text-graphite-700 antialiased`}>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <AdminAuthProvider>
          <AdminShell>{children}</AdminShell>
        </AdminAuthProvider>
      </body>
    </html>
  );
}
