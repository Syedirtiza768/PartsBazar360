/**
 * Block detection heuristics.
 *
 * A fetch that "succeeds" (HTTP 200) is not proof the target served real
 * content — WAFs answer bots with 200 + a challenge page. This module fuses
 * several weak signals into one verdict so the engine reacts to soft blocks
 * before they harden into IP bans:
 *
 *  1. Transport signals: status class, Retry-After, redirect location.
 *  2. Content markers: known CAPTCHA / interstitial phrasing (eBay, Cloudflare,
 *     PerimeterX, Akamai, DataDome) matched against title + body text.
 *  3. Shape signals: abnormally small HTML, or an extraction yield far below
 *     what the adapter expects for this page class (yield anomaly).
 *
 * severity: 'none' | 'soft' | 'hard'
 *  - hard → escalate strategy tier + circuit cooldown
 *  - soft → slow down (AIMD), retry once via requeue, escalate if persistent
 */

const HARD_BODY_MARKERS = [
  /pardon our (?:interruption|the interruption)/i,
  /robot or human/i,
  /enter the characters you see/i,
  /verify you are (?:a )?human/i,
  /are you a robot/i,
  /captcha/i,
  /security check(?:point)?/i,
  /access to this page has been (?:denied|blocked)/i,
  /your request has been blocked/i,
  /unusual (?:traffic|activity) (?:from|detected)/i,
  /please enable (?:javascript|cookies) (?:and|to) (?:continue|reload)/i,
  /attention required!?\s*\|\s*cloudflare/i,
  /cf-chl-|challenge-platform|turnstile/i,
  /px-captcha|perimeterx/i,
  /datadome/i,
  /akamai.*(?:denied|blocked|reference #)/i,
  /incident id|request blocked.*reference/i,
  /splashui|captcha-delivery/i,
];

const SOFT_BODY_MARKERS = [
  /temporarily (?:unavailable|blocked|limited)/i,
  /too many requests/i,
  /rate.?limit/i,
  /slow down/i,
  /try again (?:later|in a few)/i,
  /service unavailable/i,
];

const HARD_URL_MARKERS = [
  /[?&\/]captcha/i,
  /splashui/i,
  /challenge(?:-platform)?\//i,
  /\/clogin\.jsp|\/signin\/.*return/i, // forced-login wall treated as block for public data
];

const HARD_TITLE_MARKERS = [
  /captcha/i,
  /security check/i,
  /access denied/i,
  /attention required/i,
  /pardon our interruption/i,
  /robot check/i,
  /just a moment/i, // Cloudflare
];

/**
 * @param {object} p
 * @param {number} p.status HTTP status (0 for network failure)
 * @param {string} [p.finalUrl] URL after redirects
 * @param {string} [p.title]
 * @param {string} [p.bodyText] visible text sample (first few KB)
 * @param {number} [p.htmlLength]
 * @param {number} [p.extractedCount] items the adapter extracted
 * @param {number} [p.expectedMin] items the adapter expects at minimum (0 = unknown)
 * @param {boolean} [p.allowEmpty] page class where zero results is legitimate
 * @returns {{blocked:boolean, severity:'none'|'soft'|'hard', thin:boolean, reasons:string[]}}
 */
export function assessPage({
  status = 0,
  finalUrl = '',
  title = '',
  bodyText = '',
  htmlLength = 0,
  extractedCount = 0,
  expectedMin = 0,
  allowEmpty = false,
} = {}) {
  const reasons = [];
  let severity = 'none';
  let thin = false;

  const escalate = (sev, reason) => {
    reasons.push(reason);
    if (sev === 'hard' || severity === 'none') severity = sev === 'hard' ? 'hard' : 'soft';
  };

  // --- transport ---
  if (status === 0) escalate('soft', 'network-failure');
  if (status === 401 || status === 403 || status === 407) escalate('hard', `http-${status}`);
  if (status === 418 || status === 429) escalate('hard', `http-${status}`);
  if (status === 503) escalate('soft', 'http-503');
  if (status >= 500 && status !== 503) escalate('soft', `http-${status}`);

  if (finalUrl) {
    for (const re of HARD_URL_MARKERS) {
      if (re.test(finalUrl)) { escalate('hard', `url:${re.source}`); break; }
    }
  }

  // --- content markers (checked even on 200) ---
  const sample = `${title}\n${bodyText}`.slice(0, 12_000);
  for (const re of HARD_TITLE_MARKERS) {
    if (re.test(title)) { escalate('hard', `title:${re.source}`); break; }
  }
  for (const re of HARD_BODY_MARKERS) {
    if (re.test(sample)) { escalate('hard', `body:${re.source}`); break; }
  }
  if (severity !== 'hard') {
    for (const re of SOFT_BODY_MARKERS) {
      if (re.test(sample)) { escalate('soft', `body:${re.source}`); break; }
    }
  }

  // --- shape signals (only meaningful when transport looked fine) ---
  if (severity === 'none') {
    if (htmlLength > 0 && htmlLength < 1_500 && expectedMin > 0 && !allowEmpty) {
      escalate('soft', `tiny-html:${htmlLength}`);
    } else if (expectedMin > 0 && extractedCount === 0 && !allowEmpty) {
      escalate('soft', 'zero-yield');
    } else if (expectedMin > 0 && extractedCount > 0 && extractedCount < expectedMin * 0.25) {
      thin = true; // not a block by itself: legitimate tail pages exist
      reasons.push('low-yield');
    }
  }

  return { blocked: severity !== 'none', severity, thin, reasons };
}
