/**
 * Tier 0 — plain HTTP fetch with a coherent browser header profile.
 * Cheapest strategy; sufficient for unprotected endpoints and useful as a
 * probe. No JS execution, so WAF interstitials show up here first.
 */
import { buildHeaders } from '../fingerprint.js';
import { parseRetryAfter } from '../ratelimit.js';

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function extractBodyText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 8_000);
}

export const fetchStrategy = {
  name: 'fetch',
  tier: 0,
  needsBrowser: false,

  async fetchPage({ url }, { persona, timeoutMs = 30_000 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: buildHeaders(persona),
        redirect: 'follow',
        signal: controller.signal,
      });
      const html = await res.text();
      return {
        status: res.status,
        html,
        finalUrl: res.url,
        title: extractTitle(html),
        bodyText: extractBodyText(html),
        htmlLength: html.length,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
      };
    } catch (err) {
      return {
        status: 0,
        html: '',
        finalUrl: url,
        title: '',
        bodyText: '',
        htmlLength: 0,
        error: err.message,
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
