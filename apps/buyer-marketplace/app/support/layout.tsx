import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Customer support | PartsBazar360",
  description: "Contact PartsBazar360 support for fitment checks, order issues, returns, and sourcing requests.",
  robots: NOINDEX_ROBOTS,
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
