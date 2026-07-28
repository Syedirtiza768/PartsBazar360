/**
 * SessionManager — owns browser/context lifecycle for the browser tiers.
 *
 * A "session" = one coherent persona + one browser context (cookies,
 * storage). Sessions rotate on a human timescale (every N requests) and
 * immediately on block signals, because a flagged session's cookies are
 * burned — retrying with them only confirms the flag.
 *
 * Tiers:
 *  - headless: Playwright chromium, stealth-patched, resource-blocked (fast)
 *  - headed:   real window, no resource blocking (looks fully organic)
 *  - cdp:      attaches to the user's real Chrome over DevTools protocol;
 *              inherits its genuine fingerprint, profile and cookies.
 *              If no debug port is open it spawns Chrome with one.
 */
import { spawn } from 'node:child_process';
import { contextOptions, stealthInitScript, samplePersona } from './fingerprint.js';
import { postLoadDwell, sleep } from './humanize.js';

const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-infobars',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
];

export class SessionManager {
  constructor({
    logger = console,
    rotateAfterRequests = 35,   // human sessions are short; rotate often
    blockResources = true,      // headless tier only
    cdpEndpoint = 'http://127.0.0.1:9222',
    spawnChrome = true,
    rng = Math.random,
  } = {}) {
    this.logger = logger;
    this.rotateAfterRequests = rotateAfterRequests;
    this.blockResources = blockResources;
    this.cdpEndpoint = cdpEndpoint;
    this.spawnChrome = spawnChrome;
    this.rng = rng;

    this._playwright = null;
    this._session = null; // { tier, persona, browser?, context, page, requests, bornAt }
  }

  async _pw() {
    if (!this._playwright) {
      try {
        this._playwright = await import('playwright');
      } catch {
        throw new Error('playwright is required for browser tiers. Install it at the repo root (already a root dependency of PartsBazar360).');
      }
    }
    return this._playwright;
  }

  /** Current request count on the live session. */
  get sessionRequests() {
    return this._session?.requests ?? 0;
  }

  /** True when the live session should be replaced (age, count, or flagged). */
  needsRotation() {
    const s = this._session;
    if (!s) return true;
    const limit = this.rotateAfterRequests + Math.floor(this.rng() * 15);
    return s.requests >= limit || s.invalid;
  }

  /** Mark the live session as burned (called on block signals). */
  invalidate() {
    if (this._session) this._session.invalid = true;
  }

  /**
   * Get a page for the tier, rotating the session when due.
   * @returns {Promise<{page: object, persona: object}>}
   */
  async getPage(tier) {
    if (this.needsRotation() || this._session.tier !== tier) {
      await this._rotate(tier);
    }
    this._session.requests++;
    return { page: this._session.page, persona: this._session.persona };
  }

  async _rotate(tier) {
    await this._closeSession();
    const persona = samplePersona(this.rng);
    this.logger.debug?.(`[session] rotating → tier=${tier} persona=${persona.name} chrome/${persona.uaMajor} ${persona.viewport.width}x${persona.viewport.height} tz=${persona.timezoneId}`);

    if (tier === 'cdp') {
      this._session = await this._openCdpSession(persona);
    } else {
      this._session = await this._openPlaywrightSession(tier, persona);
    }
  }

  async _openPlaywrightSession(tier, persona) {
    const { chromium } = await this._pw();
    const headed = tier === 'headed';

    let browser;
    try {
      // Prefer the real Chrome binary: bundled Chromium carries binary-level tells.
      browser = await chromium.launch({ headless: !headed, channel: 'chrome', args: LAUNCH_ARGS });
    } catch {
      this.logger.debug?.('[session] Chrome channel unavailable, falling back to bundled chromium');
      browser = await chromium.launch({ headless: !headed, args: LAUNCH_ARGS });
    }

    const context = await browser.newContext(contextOptions(persona));
    await context.addInitScript(stealthInitScript(persona));

    if (this.blockResources && !headed) {
      // Speed: drop heavy resources. Acceptable on the stealth tier because
      // real Chrome-with-ublock-style clients also never fetch these.
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'media' || type === 'font') return route.abort();
        const url = route.request().url();
        if (/tracking|beacon|analytics|telemetry|log\./.test(url)) return route.abort();
        return route.continue();
      });
    }

    const page = await context.newPage();
    return { tier, persona, browser, context, page, requests: 0, bornAt: Date.now(), invalid: false, owned: true };
  }

  async _openCdpSession(persona) {
    const { chromium } = await this._pw();
    let browser;
    try {
      browser = await chromium.connectOverCDP(this.cdpEndpoint, { timeout: 5_000 });
    } catch {
      if (!this.spawnChrome) throw new Error(`No Chrome DevTools port at ${this.cdpEndpoint}`);
      this._spawnChromeWithDebugPort();
      let lastErr;
      for (let i = 0; i < 10; i++) {
        await sleep(1_000);
        try {
          browser = await chromium.connectOverCDP(this.cdpEndpoint, { timeout: 3_000 });
          break;
        } catch (e) { lastErr = e; }
      }
      if (!browser) throw new Error(`Could not attach to Chrome at ${this.cdpEndpoint}: ${lastErr?.message}`);
    }

    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    // No UA/viewport overrides here: the whole point of the CDP tier is that
    // this is a genuine, fully-patched Chrome with a real profile.
    return { tier: 'cdp', persona, browser, context, page, requests: 0, bornAt: Date.now(), invalid: false, owned: false };
  }

  _spawnChromeWithDebugPort() {
    const candidates = [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter(Boolean);
    const port = new URL(this.cdpEndpoint).port || '9222';
    for (const exe of candidates) {
      try {
        const child = spawn(exe, [`--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check'], {
          detached: true, stdio: 'ignore',
        });
        child.unref();
        this.logger.log(`[session] spawned Chrome with DevTools port ${port}`);
        return;
      } catch { /* try next candidate */ }
    }
    this.logger.warn('[session] could not spawn Chrome; start it manually with --remote-debugging-port=9222');
  }

  /** Organic entry: visit site root and dwell before hitting target pages. */
  async warmup(originUrl) {
    const s = this._session;
    if (!s || s.warmed || !originUrl) return;
    s.warmed = true;
    try {
      await s.page.goto(originUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await sleep(postLoadDwell(this.rng));
    } catch (e) {
      this.logger.debug?.(`[session] warmup failed (${e.message}) — continuing anyway`);
    }
  }

  async _closeSession() {
    const s = this._session;
    if (!s) return;
    this._session = null;
    try {
      if (s.owned) {
        await s.browser?.close();
      } else {
        await s.page?.close(); // CDP: close only our tab, never the user's browser
      }
    } catch { /* closing is best-effort */ }
  }

  async close() {
    await this._closeSession();
  }
}
