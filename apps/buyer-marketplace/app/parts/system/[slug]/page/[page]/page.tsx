import type { Metadata } from "next";
import {
  parsePageParam,
  renderTaxonomy,
  taxonomyMetadata,
} from "@/lib/taxonomy-page";

/**
 * Vehicle-system landing page — page 2 and beyond.
 *
 * Deep pages carry `noindex, follow` (the engine's pagination rule) but are
 * real, crawlable URLs, which is what lets a crawler reach inventory past the
 * first 48 listings without any of those grid pages entering the index.
 */
// 15 minutes. Must be a literal — Next cannot statically analyse an
// imported constant as a segment config.
export const revalidate = 900;

interface PageProps {
  params: Promise<{ slug: string; page: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, page } = await params;
  return taxonomyMetadata({ kind: "categoryGroup", slug, page: parsePageParam(page) });
}

export default async function Page({ params }: PageProps) {
  const { slug, page } = await params;
  return renderTaxonomy({ kind: "categoryGroup", slug, page: parsePageParam(page) });
}
