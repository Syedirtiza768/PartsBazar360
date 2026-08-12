import type { Metadata } from "next";
import {
  renderTaxonomy,
  taxonomyMetadata,
} from "@/lib/taxonomy-page";

/**
 * Vehicle make + model landing page — /vehicles/<make>/<model>.
 *
 * This is the deepest automatically generated combination, and it carries a
 * higher inventory threshold than a category or brand page precisely because
 * the pattern can produce far more URLs. A model with thin inventory still
 * renders and is still crawlable; it simply carries `noindex, follow` and is
 * left out of the sitemap until it has the depth to be worth indexing.
 */
// 15 minutes. Must be a literal — Next cannot statically analyse an
// imported constant as a segment config.
export const revalidate = 900;

interface PageProps {
  params: Promise<{ make: string; model: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { make, model } = await params;
  return taxonomyMetadata({ kind: "model", slug: model, parentSlug: make });
}

export default async function Page({ params }: PageProps) {
  const { make, model } = await params;
  return renderTaxonomy({ kind: "model", slug: model, parentSlug: make });
}
