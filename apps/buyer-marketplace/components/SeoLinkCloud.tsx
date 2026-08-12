import Link from "next/link";
import type { SeoInternalLink } from "@repo/catalog-contracts";

/**
 * Renders the internal links the SEO engine derived for a page.
 *
 * Deliberately server-rendered plain anchors inside a `<nav>`: these are the
 * crawl paths that keep a freshly published listing from being an orphan, so
 * they must exist in the HTML rather than appearing after hydration.
 *
 * Renders nothing when there are no links — an empty "Browse related" heading
 * is worse than no section.
 */
export function SeoLinkCloud({
  heading,
  links,
  className,
}: {
  heading: string;
  links: SeoInternalLink[];
  className?: string;
}) {
  // De-duplicate by destination: the engine may propose the same path under
  // two relations (a brand that is also a vehicle make, say).
  const seen = new Set<string>();
  const unique = links.filter((link) => {
    if (!link.path || seen.has(link.path)) return false;
    seen.add(link.path);
    return true;
  });

  if (!unique.length) return null;

  return (
    <nav aria-label={heading} className={className ?? "mt-14"}>
      <h2 className="text-lg font-bold tracking-tight text-slate-900">{heading}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {unique.map((link) => (
          <li key={link.path}>
            <Link
              href={link.path}
              data-seo-relation={link.relation}
              className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
