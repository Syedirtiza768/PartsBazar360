import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Sign in | PartsBazar360",
  robots: NOINDEX_ROBOTS,
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
