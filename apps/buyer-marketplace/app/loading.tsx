import { Skeleton } from "@repo/ui/skeleton";
import { ProductCardSkeleton } from "@/components/ProductCard";

export default function HomeLoading() {
  return (
    <div aria-busy="true">
      <section className="border-b-2 border-slate-950 bg-graphite-950 px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
        <Skeleton className="h-3 w-48 bg-white/20" />
        <Skeleton className="mt-4 h-14 w-full max-w-xl bg-white/25 sm:h-20" />
        <Skeleton className="mt-6 h-5 w-full max-w-lg bg-white/15" />
        <Skeleton className="mt-8 h-12 w-full max-w-3xl bg-white/20" />
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-8">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid grid-cols-2 border border-stone-300 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="min-h-32 border-b border-r border-stone-300 p-4">
              <Skeleton className="h-7 w-7" />
              <Skeleton className="mt-6 h-4 w-20" />
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-stone-300 bg-[#e9e5dc] px-4 py-10 sm:px-6 lg:px-8">
        <Skeleton className="h-8 w-56" />
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
