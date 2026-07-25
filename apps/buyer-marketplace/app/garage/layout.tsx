import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Your garage | PartsBazar360",
  robots: NOINDEX_ROBOTS,
};

export default function GarageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
