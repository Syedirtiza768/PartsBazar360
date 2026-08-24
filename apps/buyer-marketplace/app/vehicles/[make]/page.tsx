import type { Metadata } from "next";
import { renderTaxonomy, taxonomyMetadata } from "@/lib/taxonomy-page";

/**
 * Vehicle-make landing page — /vehicles/<make>.
 *
 * Makes come from the fitment graph, so a make page exists exactly when parts
 * are documented to fit that make. Nothing here names a manufacturer.
 */
// 15 minutes. Must be a literal — Next cannot statically analyse an
// imported constant as a segment config.
export const revalidate = 900;

interface PageProps {
  params: Promise<{ make: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { make } = await params;
  return taxonomyMetadata({ kind: "make", slug: make });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { make } = await params;
  const query = await searchParams;
  return renderTaxonomy({ kind: "make", slug: make, searchParams: query });
}
