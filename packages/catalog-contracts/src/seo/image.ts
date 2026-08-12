/**
 * Image SEO: ALT text, ordering, and priority assignment.
 *
 * ALT text is derived from the same structured attributes the title uses, so
 * it describes the item truthfully and stays consistent with the page. It is
 * deliberately *not* the title verbatim on every image — repeating one string
 * across eight `<img>` tags is what keyword stuffing looks like to a crawler.
 * Secondary images are numbered instead, which is both accurate and useful to
 * a screen-reader user.
 */

import { seoConfig } from './config';
import { primaryPartNumber } from './slug';
import { partNameCore, subjectPrefix } from './metadata';
import {
  clipHard,
  dedupeWords,
  joinParts,
  text,
  titleCase,
  uniqueStrings,
} from './text';
import type { SeoImage, SeoPartInput, SeoTaxonomyInput } from './types';

/**
 * The base descriptive phrase for a part's imagery:
 * "Bosch Toyota Corolla Lane Departure Camera 86401-12020".
 */
export function imageSubject(part: SeoPartInput): string {
  const name = titleCase(partNameCore(part));
  const number = primaryPartNumber(part);
  return (
    dedupeWords(joinParts([subjectPrefix(part), name, number])) ||
    text(part.title) ||
    joinParts([titleCase(part.category), 'auto part']) ||
    'Automotive part'
  );
}

/**
 * ALT text for one image. A curated `altText` on the media row always wins —
 * that is the per-image override — otherwise it is generated.
 */
export function imageAlt(
  part: SeoPartInput,
  index: number,
  total: number,
  curated?: string | null,
): string {
  const { limits } = seoConfig();
  const explicit = text(curated);
  if (explicit) return clipHard(explicit, limits.alt);

  const subject = imageSubject(part);
  // Only the primary image carries the full descriptive phrase. The rest say
  // what they are — an additional view — which is what the reader needs.
  if (index === 0) return clipHard(subject, limits.alt);
  return clipHard(`${subject} — view ${index + 1} of ${total}`, limits.alt);
}

/**
 * Build the ordered, de-duplicated image list for a part.
 *
 * Order matters beyond aesthetics: index 0 is the LCP element and the OG
 * image, so it must be the seller's designated primary shot rather than
 * whichever URL the importer happened to write first.
 */
export function partImages(part: SeoPartInput): SeoImage[] {
  const media = (part.media || []).filter((entry) => text(entry?.url));

  const ordered = [...media].sort((a, b) => {
    if (Boolean(a.isPrimary) !== Boolean(b.isPrimary)) return a.isPrimary ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  // `imageUrls` is the denormalised copy some import paths write without a
  // matching ProductMedia row. Union them so no image is lost, media first.
  const urls = uniqueStrings([
    ...ordered.map((entry) => entry.url),
    ...(part.imageUrls || []),
  ]);

  const byUrl = new Map(media.map((entry) => [text(entry.url), entry]));

  return urls.map((url, index) => {
    const entry = byUrl.get(url);
    return {
      url,
      alt: imageAlt(part, index, urls.length, entry?.altText),
      isPrimary: index === 0,
      ...(entry?.width ? { width: entry.width } : {}),
      ...(entry?.height ? { height: entry.height } : {}),
    };
  });
}

/**
 * True when a URL is a raster image a social crawler will actually render.
 *
 * Facebook, X, LinkedIn, and WhatsApp all refuse SVG for `og:image` and show a
 * blank card instead. This catalog hoists a generated infographic *SVG* to the
 * front of `imageUrls` for high-value parts, so the naive "first image wins"
 * rule silently broke the social card on exactly the best listings.
 */
function isRasterImage(url: string): boolean {
  const path = text(url).split(/[?#]/)[0] ?? '';
  return !/\.svgz?$/i.test(path);
}

/**
 * The image used for Open Graph and Twitter.
 *
 * Picks the first *raster* image rather than simply the first one, then falls
 * back to the site card — so a share always renders something, and never a
 * blank SVG card.
 */
export function socialImage(
  part: SeoPartInput,
  images: SeoImage[],
  absolute: (path: string) => string,
): { url: string; alt: string; width?: number; height?: number } {
  const override = text(part.seo?.ogImageUrl);
  if (override) return { url: override, alt: imageSubject(part) };

  const primary = images.find((image) => isRasterImage(image.url));
  if (primary) {
    return {
      url: primary.url,
      alt: primary.alt,
      ...(primary.width ? { width: primary.width } : {}),
      ...(primary.height ? { height: primary.height } : {}),
    };
  }

  return {
    url: absolute(seoConfig().fallbackOgImage),
    alt: `${seoConfig().siteName} — ${imageSubject(part)}`,
    width: 1728,
    height: 906,
  };
}

/** Social card image for a taxonomy page; no per-node imagery exists yet. */
export function taxonomySocialImage(
  node: SeoTaxonomyInput,
  absolute: (path: string) => string,
): { url: string; alt: string; width?: number; height?: number } {
  const override = text(node.seo?.ogImageUrl);
  if (override) return { url: override, alt: titleCase(node.name) };
  return {
    url: absolute(seoConfig().fallbackOgImage),
    alt: `${titleCase(node.name)} parts on ${seoConfig().siteName}`,
    width: 1728,
    height: 906,
  };
}

/**
 * Loading strategy per image index. The first image is the LCP candidate on
 * every PDP, so it is eager + high priority and everything else is lazy —
 * expressed here rather than in the component so a new gallery cannot
 * accidentally regress Core Web Vitals.
 */
export function imageLoading(index: number): {
  loading: 'eager' | 'lazy';
  fetchPriority: 'high' | 'auto' | 'low';
  priority: boolean;
} {
  return index === 0
    ? { loading: 'eager', fetchPriority: 'high', priority: true }
    : { loading: 'lazy', fetchPriority: 'auto', priority: false };
}

/**
 * Responsive `sizes` for the two image contexts the storefront has. Getting
 * this wrong is the most common cause of a needlessly large LCP download.
 */
export const IMAGE_SIZES = {
  /** PDP gallery: full width on mobile, roughly half the grid on desktop. */
  gallery: '(max-width: 640px) 100vw, (max-width: 1024px) 60vw, 640px',
  /** Result-grid tile: 2 up on small, 3 on medium, 4–5 on large. */
  tile: '(max-width: 480px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 20vw',
} as const;

/** True when a part has at least one usable image — used by the validator. */
export function hasImage(part: SeoPartInput): boolean {
  return partImages(part).length > 0;
}
