import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Watchlist | PartsBazar360",
  robots: NOINDEX_ROBOTS,
};

export default function WatchlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
