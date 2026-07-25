import { AccountShell } from "@/components/AccountShell";
import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Account | PartsBazar360",
  robots: NOINDEX_ROBOTS,
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
