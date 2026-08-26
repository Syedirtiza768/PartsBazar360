import { INTERNAL_API_URL } from "@/lib/api";

export type BlogPostSummary = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  updatedAt: string;
};
export type BlogPost = BlogPostSummary & { content: string };
export type ShippingPolicy = {
  cutoffTime: string;
  timezone: string;
  fulfillmentDays: string;
  handling: { minDays: number; maxDays: number; label: string; source: string };
  delivery: { regions: string; carriers: string[]; note: string };
  duties: string;
};

const FALLBACK_SHIPPING_POLICY: ShippingPolicy = {
  cutoffTime: "2:00 PM",
  timezone: "Gulf Standard Time (GST, UTC+4)",
  fulfillmentDays: "Monday-Saturday",
  handling: {
    minDays: 3,
    maxDays: 3,
    label: "3 working days",
    source: "published listing policy",
  },
  delivery: {
    regions: "Worldwide to most countries",
    carriers: ["DHL", "FedEx", "Aramex"],
    note: "Transit times vary by destination, service, item size, and carrier availability.",
  },
  duties:
    "Import duties, taxes, and other destination charges are not included unless expressly shown at checkout.",
};

async function fetchContent<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(INTERNAL_API_URL + path, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}
export const getPublishedPosts = () =>
  fetchContent<BlogPostSummary[]>("/blog/posts", []);
export const getPublishedPost = (slug: string) =>
  fetchContent<BlogPost | null>(
    "/blog/posts/" + encodeURIComponent(slug),
    null,
  );
export const getShippingPolicy = () =>
  fetchContent<ShippingPolicy>("/policy/shipping", FALLBACK_SHIPPING_POLICY);
