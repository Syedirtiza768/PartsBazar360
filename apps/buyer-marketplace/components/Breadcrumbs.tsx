import Link from "next/link";
import { ChevronRightIcon } from "@repo/ui/icons";

export interface Crumb {
  href?: string;
  label: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="scroll-rail items-center gap-1.5 text-sm text-graphite-600">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="flex min-h-9 shrink-0 items-center whitespace-nowrap transition-colors hover:text-brand-600"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className="max-w-[60vw] truncate font-medium text-slate-700 sm:max-w-none"
                  aria-current={last ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
