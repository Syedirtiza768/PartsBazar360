import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Cart | PartsBazar360",
  robots: NOINDEX_ROBOTS,
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
