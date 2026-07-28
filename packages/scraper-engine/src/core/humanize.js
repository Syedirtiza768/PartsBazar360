/**
 * Humanized behavior primitives.
 *
 * Bot detectors model inter-event timing. Uniform `sleep(1000)` or fixed
 * random ranges are themselves a signature: humans produce heavy-tailed
 * intervals (log-normal / gamma), not uniform ones. All delays here are
 * sampled from log-normal distributions, and long "reading pauses" are
 * injected on a human cadence (every several pages), not at fixed offsets.
 */

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function rand(min, max, rng = Math.random) {
  return min + rng() * (max - min);
}

export function randInt(min, max, rng = Math.random) {
  return Math.floor(rand(min, max + 1, rng));
}

/** Box–Muller standard normal. */
function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * Log-normal sample with the given median. sigma controls tail heaviness.
 * Median human reaction-to-next-action on listing pages is ~1–2s with a
 * long right tail — uniform random cannot reproduce that tail.
 */
export function logNormal(medianMs, sigma = 0.55, rng = Math.random) {
  return medianMs * Math.exp(sigma * gauss(rng));
}

/** Inter-request delay between page fetches. */
export function pageInterval(rng = Math.random) {
  return Math.min(12_000, Math.max(500, logNormal(1_300, 0.5, rng)));
}

/** Long dwell that mimics a human actually reading a results page. */
export function readingPause(rng = Math.random) {
  return Math.min(45_000, Math.max(5_000, logNormal(9_000, 0.6, rng)));
}

/** Short dwell after page load before extraction (render + glance time). */
export function postLoadDwell(rng = Math.random) {
  return Math.min(6_000, Math.max(800, logNormal(1_600, 0.5, rng)));
}

/** Whether to take a reading pause now: ~ every 6–14 pages on average. */
export function shouldRead(pagesSincePause, rng = Math.random) {
  return pagesSincePause >= randInt(6, 14, rng);
}

/**
 * Mouse drift along a jittered quadratic-bezier path. Bots teleport the
 * cursor; humans accelerate/decelerate through curved trajectories.
 */
export async function mouseDrift(page, rng = Math.random) {
  try {
    const vp = page.viewportSize() || { width: 1366, height: 768 };
    const x0 = rand(0.1, 0.9, rng) * vp.width;
    const y0 = rand(0.1, 0.9, rng) * vp.height;
    const x1 = rand(0.1, 0.9, rng) * vp.width;
    const y1 = rand(0.1, 0.9, rng) * vp.height;
    const cx = (x0 + x1) / 2 + rand(-0.25, 0.25, rng) * vp.width;
    const cy = (y0 + y1) / 2 + rand(-0.25, 0.25, rng) * vp.height;
    const steps = randInt(8, 20, rng);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1 + rand(-3, 3, rng);
      const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1 + rand(-3, 3, rng);
      await page.mouse.move(Math.round(x), Math.round(y));
      await sleep(rand(8, 40, rng));
    }
  } catch { /* mouse is best-effort */ }
}

/**
 * Scroll the page like a scanning human: variable-depth wheel steps with
 * irregular pauses, occasionally back up. Also triggers lazy-loaded results.
 */
export async function humanScroll(page, rng = Math.random, { maxSteps = 6 } = {}) {
  try {
    const steps = randInt(2, maxSteps, rng);
    for (let i = 0; i < steps; i++) {
      const delta = rand(0.4, 1.2, rng) * (page.viewportSize()?.height || 800);
      await page.mouse.wheel(0, Math.round(delta));
      await sleep(Math.min(2_500, Math.max(250, logNormal(650, 0.6, rng))));
      if (rng() < 0.15) {
        await page.mouse.wheel(0, -Math.round(delta * rand(0.2, 0.5, rng)));
        await sleep(rand(300, 900, rng));
      }
    }
  } catch { /* scroll is best-effort */ }
}
