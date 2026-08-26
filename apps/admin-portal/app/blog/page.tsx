"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Badge } from "@repo/ui/badge";
import { Button, buttonClasses } from "@repo/ui/button";
import { PageBody } from "@repo/ui/container";
import { Input, Textarea, Select } from "@repo/ui/field";
import { PageHeader } from "@repo/ui/page-header";
import { useAdminAuth } from "@/lib/auth-context";
import { API_BASE_URL, apiFetch } from "@/lib/api";

type Status = "DRAFT" | "PUBLISHED";
type Post = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  coverImageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: Status;
  publishedAt: string | null;
  updatedAt: string;
};
type FormState = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string;
  seoTitle: string;
  seoDescription: string;
  status: Status;
};
const EMPTY: FormState = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  coverImageUrl: "",
  seoTitle: "",
  seoDescription: "",
  status: "DRAFT",
};

function toForm(post?: Post): FormState {
  return post
    ? {
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt || "",
        content: post.content,
        coverImageUrl: post.coverImageUrl || "",
        seoTitle: post.seoTitle || "",
        seoDescription: post.seoDescription || "",
        status: post.status,
      }
    : EMPTY;
}
function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
function dateLabel(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Not published";
}

export default function BlogCmsPage() {
  const { token } = useAdminAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugEdited, setSlugEdited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPosts(selectId?: string | null) {
    if (!token) return;
    setLoading(true);
    try {
      const response = await apiFetch(
        token,
        API_BASE_URL + "/admin/blog/posts",
      );
      if (!response.ok) throw new Error("Could not load blog posts.");
      const data = (await response.json()) as Post[];
      setPosts(Array.isArray(data) ? data : []);
      const nextId = selectId || selectedId || data[0]?.id || null;
      const next = data.find((post) => post.id === nextId);
      if (next) {
        setSelectedId(next.id);
        setForm(toForm(next));
        setSlugEdited(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load blog posts.",
      );
    } finally {
      setLoading(false);
    }
  }

  // loadPosts is intentionally local to keep its token-dependent request simple.
  useEffect(() => {
    if (token) void loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function startNew() {
    setSelectedId(null);
    setForm(EMPTY);
    setSlugEdited(false);
    setMessage(null);
    setError(null);
  }
  function selectPost(post: Post) {
    setSelectedId(post.id);
    setForm(toForm(post));
    setSlugEdited(true);
    setMessage(null);
    setError(null);
  }
  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  function onTitleChange(event: ChangeEvent<HTMLInputElement>) {
    const title = event.target.value;
    setForm((current) => ({
      ...current,
      title,
      slug: slugEdited ? current.slug : slugify(title),
    }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await apiFetch(
        token,
        API_BASE_URL +
          "/admin/blog/posts" +
          (selectedId ? "/" + selectedId : ""),
        {
          method: selectedId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          typeof body?.message === "string"
            ? body.message
            : "Could not save the blog post.",
        );
      }
      const saved = (await response.json()) as Post;
      setMessage(
        saved.status === "PUBLISHED"
          ? "Post saved and published."
          : "Draft saved.",
      );
      await loadPosts(saved.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the blog post.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!token || !selectedId || !window.confirm("Delete this blog post?"))
      return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(
        token,
        API_BASE_URL + "/admin/blog/posts/" + selectedId,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Could not delete the blog post.");
      startNew();
      setMessage("Post deleted.");
      await loadPosts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete the blog post.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageBody size="wide" className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Content management"
        title="Blog CMS"
        description="Create, edit, preview, and publish buyer-facing posts under /buyer/blog/."
        actions={
          <Button onClick={startNew} variant="secondary">
            New post
          </Button>
        }
      />
      {message && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.7fr)]">
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold text-slate-950">Posts</h2>
            <span className="text-xs text-graphite-600">{posts.length}</span>
          </div>
          <div className="mt-4 space-y-2">
            {loading && (
              <p className="text-sm text-graphite-600">Loading posts...</p>
            )}
            {!loading && posts.length === 0 && (
              <p className="text-sm text-graphite-600">
                No posts yet. Create the first guide.
              </p>
            )}
            {posts.map((post) => (
              <button
                key={post.id}
                type="button"
                onClick={() => selectPost(post)}
                className={
                  "w-full rounded-lg border p-3 text-left transition-colors " +
                  (selectedId === post.id
                    ? "border-brand-500 bg-brand-50"
                    : "border-slate-200 hover:border-slate-300")
                }
              >
                <span className="block truncate text-sm font-semibold text-slate-950">
                  {post.title}
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-xs text-graphite-600">
                  <Badge
                    tone={post.status === "PUBLISHED" ? "success" : "outline"}
                    size="sm"
                  >
                    {post.status}
                  </Badge>
                  <span>{dateLabel(post.publishedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <form
          onSubmit={save}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-950">
                {selectedId ? "Edit post" : "New post"}
              </h2>
              <p className="mt-1 text-sm text-graphite-600">
                Content is plain text with optional ## headings and - bullet
                lines.
              </p>
            </div>
            {selectedId && (
              <button
                type="button"
                onClick={remove}
                className={buttonClasses({ variant: "danger", size: "sm" })}
                disabled={saving}
              >
                Delete
              </button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Title"
              required
              value={form.title}
              onChange={onTitleChange}
              placeholder="How to verify part fitment"
            />
            <Input
              label="Slug"
              required
              value={form.slug}
              onChange={(event) => {
                setSlugEdited(true);
                updateField("slug", slugify(event.target.value));
              }}
              hint="Used in the public URL."
            />
          </div>
          <Textarea
            label="Excerpt"
            value={form.excerpt}
            onChange={(event) => updateField("excerpt", event.target.value)}
            hint="Short summary shown on the blog index and used as a fallback description."
          />
          <Textarea
            label="Content"
            required
            value={form.content}
            onChange={(event) => updateField("content", event.target.value)}
            className="min-h-[260px]"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Cover image URL"
              type="url"
              value={form.coverImageUrl}
              onChange={(event) =>
                updateField("coverImageUrl", event.target.value)
              }
            />
            <Select
              label="Publishing status"
              value={form.status}
              onChange={(event) =>
                updateField("status", event.target.value as Status)
              }
            >
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="SEO title"
              value={form.seoTitle}
              onChange={(event) => updateField("seoTitle", event.target.value)}
            />
            <Input
              label="SEO description"
              value={form.seoDescription}
              onChange={(event) =>
                updateField("seoDescription", event.target.value)
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
            <Button type="submit" loading={saving}>
              {selectedId ? "Save changes" : "Create post"}
            </Button>
            {form.slug && (
              <Link
                href={"/buyer/blog/" + form.slug}
                target="_blank"
                className={buttonClasses({ variant: "outline" })}
              >
                Open public page
              </Link>
            )}
          </div>
        </form>
      </div>
    </PageBody>
  );
}
