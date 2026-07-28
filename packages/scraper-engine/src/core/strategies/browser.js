/**
 * Browser tiers — headless / headed / cdp.
 *
 * One strategy factory parameterized by tier; the SessionManager supplies a
 * stealth-patched, persona-coherent page. Behavior layer: organic dwell after
 * load, occasional mouse drift and human scrolling before extraction, so the
 * interaction telemetry (where collected) looks human.
 */
import { humanScroll, mouseDrift, postLoadDwell, sleep } from '../humanize.js';

export function makeBrowserStrategy(name, tier) {
  return {
    name,
    tier,
    needsBrowser: true,

    async fetchPage({ url }, { sessionManager, rng, timeoutMs = 45_000 }) {
      const { page } = await sessionManager.getPage(name);
      let response = null;
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      } catch (err) {
        return {
          status: 0, html: '', finalUrl: url, title: '', bodyText: '', htmlLength: 0,
          error: err.message,
        };
      }

      await sleep(postLoadDwell(rng));
      if (rng() < 0.5) await mouseDrift(page, rng);
      await humanScroll(page, rng);

      let html = '';
      let title = '';
      let bodyText = '';
      try {
        html = await page.content();
        title = await page.title();
        bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 8_000) ?? '');
      } catch (err) {
        return {
          status: response?.status() ?? 0, html: '', finalUrl: page.url(), title: '', bodyText: '', htmlLength: 0,
          error: err.message,
        };
      }

      let retryAfterMs = 0;
      try {
        const ra = response?.headers?.()['retry-after'];
        if (ra && /^\d+$/.test(ra)) retryAfterMs = Number(ra) * 1000;
      } catch { /* optional */ }

      return {
        status: response?.status() ?? 200,
        html,
        finalUrl: page.url(),
        title,
        bodyText,
        htmlLength: html.length,
        retryAfterMs,
      };
    },
  };
}

export const headlessStrategy = makeBrowserStrategy('headless', 1);
export const headedStrategy = makeBrowserStrategy('headed', 2);
export const cdpStrategy = makeBrowserStrategy('cdp', 3);
