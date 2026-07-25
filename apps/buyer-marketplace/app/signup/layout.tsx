import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Create account | PartsBazar360",
  robots: NOINDEX_ROBOTS,
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
