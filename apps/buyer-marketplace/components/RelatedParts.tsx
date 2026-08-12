import { ProductCard } from "@/components/ProductCard";
import type { Part } from "@/lib/types";

/**
 * Related listings, chosen by the shared engine's attribute scorer.
 *
 * The list is never padded to fill the grid: if only three listings share a
 * part number, category, or vehicle with this one, three are shown. Filling
 * the remainder with arbitrary inventory would be a manipulative internal
 * link under Google's spam policy and useless to a buyer besides.
 */
export function RelatedParts({ items }: { items: Part[] }) {
  if (!items.length) return null;

  return (
    <section aria-labelledby="related-heading" className="mt-14">
      <h2
        id="related-heading"
        className="text-lg font-bold tracking-tight text-slate-900"
      >
        Related parts
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-3 xs:grid-cols-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
        {items.map((part) => (
          <ProductCard key={part.id} part={part} />
        ))}
      </div>
    </section>
  );
}
