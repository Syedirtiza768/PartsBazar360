const STOREFRONT_ORIGIN = "https://partsbazar360.com";

export function internalBlogHref(value: string): string | null {
  const destination = value.trim();
  if (/\s|\\/.test(destination)) return null;
  if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(destination)) return null;

  try {
    const url = new URL(destination, STOREFRONT_ORIGIN);
    if (
      (url.host !== "partsbazar360.com" &&
        url.host !== "www.partsbazar360.com") ||
      url.username ||
      url.password ||
      url.pathname.startsWith("//")
    ) {
      return null;
    }

    return `${url.pathname}${url.search}${url.hash}`
      .replaceAll("(", "%28")
      .replaceAll(")", "%29");
  } catch {
    return null;
  }
}

export function* blogLinks(content: string) {
  // The blog supports inline links within its existing line-based format.
  for (const match of content.matchAll(
    /(?<![!\\])\[([^\][\r\n]+)\]\(([^()\s]+)\)/g,
  )) {
    const [markup, label, destination] = match;
    if (!label?.trim() || !destination) continue;
    const href = internalBlogHref(destination);
    if (href) {
      yield {
        start: match.index,
        end: match.index + markup.length,
        label,
        href,
      };
    }
  }
}
