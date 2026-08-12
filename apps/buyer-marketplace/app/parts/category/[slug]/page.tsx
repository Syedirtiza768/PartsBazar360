import type { Metadata } from "next";
import {
  renderTaxonomy,
  taxonomyMetadata,
} from "@/lib/taxonomy-page";

/**
 * Category landing page — /parts/category/<slug>.
 *
 * Generated entirely from catalog data: no route here names a specific
 * category. A new one appears the moment the catalog contains enough
 * inventory for it, and disappears when it does not.
 */
// 15 minutes. Must be a literal — Next cannot statically analyse an
// imported constant as a segment config.
export const revalidate = 900;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return taxonomyMetadata({ kind: "category", slug });
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  return renderTaxonomy({ kind: "category", slug });
}
