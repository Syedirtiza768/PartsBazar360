/**
 * Fingerprint personas.
 *
 * Anti-bot systems don't check one signal — they check *coherence* across
 * signals. A Chrome/125 UA with a Chrome/120 sec-ch-ua, a Windows UA with a
 * macOS screen profile, or en-US locale with an Asia timezone are all cheap
 * tells. So instead of randomizing each header independently, the engine
 * samples one coherent *persona* per session and derives everything from it:
 * UA, client hints, viewport, locale, timezone, hardware, WebGL strings.
 *
 * Personas rotate per session (never per request — real users keep one
 * fingerprint for the whole session).
 */

const CHROME_VERSIONS = ['124.0.0.0', '125.0.0.0', '126.0.0.0', '127.0.0.0'];

const PERSONAS = [
  {
    weight: 4,
    name: 'chrome-win',
    platform: 'Win32',
    uaPlatform: '"Windows"',
    vendor: 'Google Inc.',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'],
    viewports: [[1920, 1080], [1536, 864], [1366, 768], [1600, 900]],
    hardwareConcurrency: [8, 12, 16],
    deviceMemory: [8, 16],
    webgl: [
      ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
      ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
      ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ],
  },
  {
    weight: 2,
    name: 'chrome-mac',
    platform: 'MacIntel',
    uaPlatform: '"macOS"',
    vendor: 'Google Inc.',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezones: ['America/New_York', 'America/Los_Angeles'],
    viewports: [[1512, 982], [1440, 900], [1680, 1050]],
    hardwareConcurrency: [8, 10, 12],
    deviceMemory: [8, 16],
    webgl: [
      ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)'],
      ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'],
    ],
  },
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Sample one coherent persona. Pass a seeded rng for reproducibility. */
export function samplePersona(rng = Math.random) {
  const total = PERSONAS.reduce((s, p) => s + p.weight, 0);
  let roll = rng() * total;
  let base = PERSONAS[0];
  for (const p of PERSONAS) { roll -= p.weight; if (roll <= 0) { base = p; break; } }

  const chrome = pick(rng, CHROME_VERSIONS);
  const major = chrome.split('.')[0];
  const isMac = base.name === 'chrome-mac';
  const ua = isMac
    ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
    : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;

  const [w, h] = pick(rng, base.viewports);
  const [glVendor, glRenderer] = pick(rng, base.webgl);

  return {
    name: base.name,
    userAgent: ua,
    uaMajor: major,
    uaFullVersion: chrome,
    platform: base.platform,
    secChUa: `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not-A.Brand";v="99"`,
    secChUaPlatform: base.uaPlatform,
    vendor: base.vendor,
    locale: base.locale,
    languages: base.languages,
    timezoneId: pick(rng, base.timezones),
    viewport: { width: w, height: h },
    hardwareConcurrency: pick(rng, base.hardwareConcurrency),
    deviceMemory: pick(rng, base.deviceMemory),
    webglVendor: glVendor,
    webglRenderer: glRenderer,
  };
}

/** Headers for the plain-fetch tier (no JS execution). */
export function buildHeaders(persona) {
  return {
    'User-Agent': persona.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': `${persona.languages.join(',')};q=0.9`.replace(',en;', ';q=0.9,en;') || 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': persona.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': persona.secChUaPlatform,
    'sec-ch-ua-platform-version': '"15.0.0"',
    'sec-ch-ua-full-version': `"${persona.uaFullVersion}"`,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  };
}

/**
 * Playwright context options derived from a persona.
 */
export function contextOptions(persona) {
  return {
    userAgent: persona.userAgent,
    viewport: persona.viewport,
    locale: persona.locale,
    timezoneId: persona.timezoneId,
    extraHTTPHeaders: {
      'Accept-Language': `${persona.languages[0]},${persona.languages[1] || 'en'};q=0.9`,
      'sec-ch-ua': persona.secChUa,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': persona.secChUaPlatform,
    },
  };
}

/**
 * Stealth init script — runs before any page JS in every frame.
 * Patches the automation artifacts that bot detectors probe. Everything
 * patched here stays consistent with the persona (hardware, WebGL, platform).
 */
export function stealthInitScript(persona) {
  const p = JSON.stringify({
    languages: persona.languages,
    platform: persona.platform,
    vendor: persona.vendor,
    hardwareConcurrency: persona.hardwareConcurrency,
    deviceMemory: persona.deviceMemory,
    webglVendor: persona.webglVendor,
    webglRenderer: persona.webglRenderer,
    uaFullVersion: persona.uaFullVersion,
    uaMajor: persona.uaMajor,
    secChUaPlatform: persona.secChUaPlatform.replace(/"/g, ''),
  });

  return `
(() => {
  const P = ${p};
  const define = (obj, prop, value) => {
    try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); } catch (e) {}
  };

  // 1. The single biggest tell: navigator.webdriver
  define(navigator, 'webdriver', undefined);
  try { delete Object.getPrototypeOf(navigator).webdriver; } catch (e) {}

  // 2. Languages / platform / vendor / hardware — coherent with persona
  define(navigator, 'languages', Object.freeze([...P.languages]));
  define(navigator, 'platform', P.platform);
  define(navigator, 'vendor', P.vendor);
  define(navigator, 'hardwareConcurrency', P.hardwareConcurrency);
  define(navigator, 'deviceMemory', P.deviceMemory);
  define(navigator, 'maxTouchPoints', 0);

  // 3. Plugins: headless Chrome ships an empty PluginArray; real Chrome has these
  const pluginData = [
    ['PDF Viewer', 'Portable Document Format', ['application/pdf']],
    ['Chrome PDF Viewer', 'Portable Document Format', ['application/pdf']],
    ['Chromium PDF Viewer', 'Portable Document Format', ['application/pdf']],
    ['Microsoft Edge PDF Viewer', 'Portable Document Format', ['application/pdf']],
    ['WebKit built-in PDF', 'Portable Document Format', ['application/pdf']],
  ];
  const plugins = pluginData.map(([name, desc]) => {
    const mime = { type: 'application/pdf', suffixes: 'pdf', description: desc };
    return { name, description: desc, filename: 'internal-pdf-viewer', 0: mime, length: 1, item: () => mime, namedItem: () => mime };
  });
  plugins.item = (i) => plugins[i];
  plugins.namedItem = (n) => plugins.find((pl) => pl.name === n) || null;
  plugins.refresh = () => {};
  define(navigator, 'plugins', plugins);
  define(navigator, 'mimeTypes', [{ type: 'application/pdf', suffixes: 'pdf' }]);

  // 4. window.chrome runtime (missing in automation)
  if (!window.chrome) {
    window.chrome = {};
  }
  window.chrome.runtime = window.chrome.runtime || { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {}, connect: () => {}, sendMessage: () => {} };
  window.chrome.app = window.chrome.app || { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }, getDetails: () => null, getIsInstalled: () => false, installState: () => 'not_installed', runningState: () => 'cannot_run' };
  window.chrome.csi = window.chrome.csi || (() => ({ onloadT: Date.now(), pageE: Date.now(), startE: Date.now() - 200, tran: 15 }));
  window.chrome.loadTimes = window.chrome.loadTimes || (() => ({ commitLoadTime: Date.now() / 1000, connectionInfo: 'h2', finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000, navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: Date.now() / 1000 - 0.5, startLoadTime: Date.now() / 1000 - 0.5, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true }));

  // 5. userAgentData (client hints JS surface) coherent with UA
  define(navigator, 'userAgentData', {
    brands: [
      { brand: 'Chromium', version: P.uaMajor },
      { brand: 'Google Chrome', version: P.uaMajor },
      { brand: 'Not-A.Brand', version: '99' },
    ],
    mobile: false,
    platform: P.secChUaPlatform,
    getHighEntropyValues: (hints) => Promise.resolve({
      architecture: 'x86', bitness: '64', brands: this?.brands || [],
      fullVersionList: [{ brand: 'Chromium', version: P.uaFullVersion }, { brand: 'Google Chrome', version: P.uaFullVersion }, { brand: 'Not-A.Brand', version: '99.0.0.0' }],
      mobile: false, model: '', platform: P.secChUaPlatform,
      platformVersion: '15.0.0', uaFullVersion: P.uaFullVersion,
    }),
    toJSON: () => ({}),
  });

  // 6. Permissions: automation returns 'denied' for notifications; humans get 'default'
  if (window.navigator.permissions && window.navigator.permissions.query) {
    const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (params) =>
      params && params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  }

  // 7. WebGL vendor/renderer — headless leaks "SwiftShader"/"Google SwiftShader"
  const patchGL = (proto) => {
    if (!proto || !proto.getParameter) return;
    const orig = proto.getParameter;
    proto.getParameter = function (param) {
      if (param === 37445) return P.webglVendor;    // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return P.webglRenderer;  // UNMASKED_RENDERER_WEBGL
      return orig.call(this, param);
    };
  };
  patchGL(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
  patchGL(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);

  // 8. Connection info (present in real Chrome)
  define(navigator, 'connection', { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false });

  // 9. Hide the Playwright/CDP binding artifacts
  for (const key of ['__playwright', '__pwInitScripts', 'cdc_adoQpoasnfa76pfcZLmcfl_Array', 'cdc_adoQpoasnfa76pfcZLmcfl_Promise', 'cdc_adoQpoasnfa76pfcZLmcfl_Symbol']) {
    try { delete window[key]; } catch (e) {}
  }
})();
`;
}
