import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlogBody } from "@/components/BlogBody";
import { getPublishedPost } from "@/lib/content";

type Props = { params: Promise<{ slug: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) return { title: "Blog post | PartsBazar360" };
  return {
    title: post.seoTitle || post.title + " | PartsBazar360",
    description: post.seoDescription || post.excerpt || undefined,
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) notFound();
  const date = post.publishedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(
        new Date(post.publishedAt),
      )
    : "PartsBazar360";
  return (
    <article className="mx-auto max-w-3xl gutter py-8 sm:py-12">
      <Link
        href="/blog"
        className="text-sm font-semibold text-brand-600 hover:text-brand-700"
      >
        &lt;- All buyer guides
      </Link>
      <header className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-graphite-500">
          {date}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          {post.title}
        </h1>
        {post.excerpt && (
          <p className="mt-4 text-lg leading-relaxed text-graphite-600">
            {post.excerpt}
          </p>
        )}
      </header>
      {post.coverImageUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={post.coverImageUrl}
          alt=""
          className="mt-8 max-h-[28rem] w-full rounded-xl object-cover"
        />
      )}
      <div className="mt-8 border-t border-slate-200 pt-8">
        <BlogBody content={post.content} />
      </div>
    </article>
  );
}
