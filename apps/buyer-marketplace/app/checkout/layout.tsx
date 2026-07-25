import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Checkout | PartsBazar360",
  robots: NOINDEX_ROBOTS,
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
