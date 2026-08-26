import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedPosts } from "@/lib/content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "PartsBazar360 Blog",
  description:
    "Guides and updates about buying automotive parts with confidence.",
};

function dateLabel(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "PartsBazar360";
}

export default async function BlogIndexPage() {
  const posts = await getPublishedPosts();
  return (
    <div className="mx-auto max-w-wide gutter py-8 sm:py-12">
      <header className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">
          From PartsBazar360
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          Buyer guides and marketplace updates
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-graphite-600 sm:text-base">
          Practical guidance for checking fitment, comparing condition,
          understanding shipping, and buying auto parts with fewer surprises.
        </p>
      </header>
      {posts.length === 0 ? (
        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-card">
          <h2 className="text-lg font-bold text-slate-950">
            New guides are on the way
          </h2>
          <p className="mt-2 text-sm text-graphite-600">
            Check back soon or contact our support team if you need help with an
            order.
          </p>
          <Link
            href="/support"
            className="mt-5 inline-flex min-h-touch items-center rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
          >
            Contact support
          </Link>
        </section>
      ) : (
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <article
              key={post.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
            >
              {post.coverImageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={post.coverImageUrl}
                  alt=""
                  className="h-44 w-full object-cover"
                />
              ) : (
                <div className="flex h-44 items-end bg-graphite-950 p-5">
                  <span className="font-display text-2xl font-black uppercase tracking-tight text-brand-300">
                    PartsBazar360
                  </span>
                </div>
              )}
              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-graphite-500">
                  {dateLabel(post.publishedAt)}
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
                  <Link
                    href={"/blog/" + post.slug}
                    className="hover:text-brand-700"
                  >
                    {post.title}
                  </Link>
                </h2>
                {post.excerpt && (
                  <p className="mt-2 text-sm leading-relaxed text-graphite-600">
                    {post.excerpt}
                  </p>
                )}
                <Link
                  href={"/blog/" + post.slug}
                  className="mt-4 inline-flex min-h-9 items-center text-sm font-bold text-brand-600 hover:text-brand-700"
                >
                  Read guide{" "}
                  <span aria-hidden="true" className="ml-1">
                    -&gt;
                  </span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
