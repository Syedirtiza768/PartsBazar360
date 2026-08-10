/**
 * Lightweight server-side HTML sanitizer for eBay seller descriptions.
 *
 * Strips dangerous elements (script, style, iframe, event handlers, javascript:
 * URIs) while preserving safe structural/formatting tags so the description
 * renders as intended instead of showing raw HTML source.
 */

const DANGEROUS_TAGS =
  /<\s*\/?\s*(script|style|iframe|object|embed|applet|form|input|button|select|textarea|link|meta|base|svg|math)[^>]*>/gi;
const EVENT_HANDLER = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
const JAVASCRIPT_URI =
  /(href|src|action)\s*=\s*["']?\s*javascript\s*:/gi;
const DATA_URI_IMG =
  /src\s*=\s*["']?\s*data\s*:(?!image\/(png|jpe?g|gif|webp|svg\+xml))/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

/** Strip entire <style>, <script> and <noscript> blocks including their
 *  content — the tag-only regex above would leave the inner text as raw
 *  visible text (e.g. CSS rules showing on the page). */
const BLOCK_ELEMENTS = /<(style|script|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Decode common HTML entities so descriptions render as formatted HTML
 *  rather than literal text (e.g. `&lt;p&gt;` → `<p>`). */
function decodeHtmlEntities(html: string): string {
  if (!html) return "";
  return (
    html
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  );
}

export function sanitizeProductHtml(html: string): string {
  if (!html) return "";
  return decodeHtmlEntities(
    html
      .replace(COMMENTS, "")
      .replace(BLOCK_ELEMENTS, "")
      .replace(DANGEROUS_TAGS, "")
      .replace(EVENT_HANDLER, "")
      .replace(JAVASCRIPT_URI, ' $1="about:blank"')
      .replace(DATA_URI_IMG, 'src="about:blank"')
      .trim(),
  );
}

/**
 * Strip all HTML tags for use in meta descriptions, plain-text excerpts, etc.
 */
export function stripHtmlTags(html: string): string {
  if (!html) return "";
  return (
    html
      // block-level tags become newlines so words don't merge
      .replace(/<\/(p|div|br|li|h[1-6]|tr|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
