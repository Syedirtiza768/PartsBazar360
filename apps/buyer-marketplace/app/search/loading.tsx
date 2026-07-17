import { Skeleton } from "@repo/ui/skeleton";
import { ProductCardSkeleton } from "@/components/ProductCard";

export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8" aria-busy="true">
      <div className="border-b border-slate-200 pb-5">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>
      <div className="flex flex-col gap-8 pt-6 lg:flex-row">
        <div className="hidden w-60 shrink-0 space-y-3 lg:block">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
          <Skeleton className="mt-6 h-5 w-20" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={`b-${i}`} className="h-4 w-full" />
          ))}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
