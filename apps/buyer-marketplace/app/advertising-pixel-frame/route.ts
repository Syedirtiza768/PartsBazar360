import { createHash } from "node:crypto";

const html = String.raw`<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<script>
(() => {
  if (parent === window) return;
  const metaId = '1629408292294202';
  const tiktokId = 'DBS6C7RC77U657ENO7K0';
  let revoked = false;
  let metaUser = '';
  let tiktokUser = '';

  // Hashed advanced-matching fields from the storefront (SHA-256 hex only).
  function cleanUser(user) {
    if (!user || typeof user !== 'object') return {};
    const out = {};
    for (const key of ['em', 'ph', 'phE164', 'fn', 'ln', 'ct', 'zp', 'country', 'external_id']) {
      if (typeof user[key] === 'string' && /^[a-f0-9]{64}$/.test(user[key])) out[key] = user[key];
    }
    return out;
  }

  function metaMatching(user) {
    const out = {};
    for (const key of ['em', 'ph', 'fn', 'ln', 'ct', 'zp', 'country', 'external_id']) {
      if (user[key]) out[key] = user[key];
    }
    return out;
  }

  function load(src) {
    const script = document.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = src;
    document.head.append(script);
  }

  function meta(user) {
    const matching = metaMatching(user);
    const key = JSON.stringify(matching);
    if (window.fbq) {
      // Re-init updates advanced matching once new customer details arrive.
      if (key !== metaUser && key !== '{}') {
        metaUser = key;
        window.fbq('init', metaId, matching);
      }
      return window.fbq;
    }
    metaUser = key;
    const fbq = function () {
      if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
      else fbq.queue.push(arguments);
    };
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    window.fbq = window._fbq = fbq;
    fbq('set', 'autoConfig', false, metaId);
    fbq('init', metaId, matching);
    load('https://connect.facebook.net/en_US/fbevents.js');
    return fbq;
  }

  function tiktok() {
    if (window.ttq) return window.ttq;
    window.TiktokAnalyticsObject = 'ttq';
    const ttq = window.ttq = [];
    ttq.methods = [
      'page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once',
      'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent',
      'revokeConsent', 'grantConsent'
    ];
    ttq.setAndDefer = (target, name) => {
      target[name] = function () {
        target.push([name].concat(Array.prototype.slice.call(arguments)));
      };
    };
    ttq.methods.forEach((method) => ttq.setAndDefer(ttq, method));
    ttq._i = { [tiktokId]: [] };
    ttq._i[tiktokId]._u = 'https://analytics.tiktok.com/i18n/pixel/events.js';
    ttq._t = { [tiktokId]: Date.now() };
    ttq._o = { [tiktokId]: {} };
    ttq.instance = (id) => {
      const instance = ttq._i[id] || [];
      ttq.methods.forEach((method) => ttq.setAndDefer(instance, method));
      return instance;
    };
    load(ttq._i[tiktokId]._u + '?sdkid=' + tiktokId + '&lib=ttq');
    return ttq;
  }

  const allowedEvents = [
    'PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout',
    'Purchase', 'AddToWishlist', 'Lead', 'Contact', 'EbayStoreClick'
  ];
  const route = /^\/buyer\/(?:[a-z-]{1,20}\/(?:success\/)?)?$/;

  function details(event, config, vendor) {
    if (!event.items?.length) {
      return {
        ...(event.search ? { search_string: event.search } : {}),
        ...(event.contact ? { content_category: event.contact } : {}),
        ...(event.name === 'Lead' ? { content_category: 'freight_quote' } : {}),
      };
    }
    const ids = event.items.map((item) => item[config.catalogKey]);
    if (ids.some((id) => !id)) return;
    const money = typeof event.value === 'number';
    if (money && (!config.currencies.includes(event.currency) || !Number.isFinite(event.value) || event.value < 0)) return;
    const quantity = event.items.reduce((sum, item) => sum + item.quantity, 0);
    const contents = event.items.map((item, index) => vendor === 'meta'
      ? { id: ids[index], quantity: item.quantity, item_price: item.price }
      : {
          content_id: ids[index], content_type: 'product', content_name: item.name,
          price: item.price, quantity: item.quantity,
        });
    return {
      ...(money ? { currency: event.currency, value: event.value } : {}),
      contents,
      content_type: 'product',
      ...(vendor === 'meta'
        ? { content_ids: ids, num_items: quantity, content_name: event.items[0].name }
        : { quantity }),
      ...(event.name === 'Lead' ? { content_category: 'freight_quote' } : {}),
      ...(event.contact ? { content_category: event.contact } : {}),
    };
  }

  window.addEventListener('message', (message) => {
    if (message.origin !== location.origin || message.source !== parent) return;
    if (message.data?.type === 'pb-ad-revoke') {
      revoked = true;
      window.fbq?.('consent', 'revoke');
      window.ttq?.revokeConsent?.();
      return;
    }
    if (revoked || message.data?.type !== 'pb-ad-event') return;
    const { event, path, config } = message.data;
    const user = cleanUser(message.data.user);
    if (!allowedEvents.includes(event?.name) || !route.test(path)) return;
    history.replaceState(null, '', path);
    if (config.meta) {
      const data = details(event, config.meta, 'meta');
      if (data) meta(user)(event.name === 'EbayStoreClick' ? 'trackSingleCustom' : 'trackSingle',
        metaId, event.name, data, { eventID: event.id });
    }
    if (config.tiktok) {
      const data = details(event, config.tiktok, 'tiktok');
      if (data) {
        const ttq = tiktok();
        const identity = {
          ...(user.em ? { email: user.em } : {}),
          ...(user.phE164 ? { phone_number: user.phE164 } : {}),
          ...(user.external_id ? { external_id: user.external_id } : {}),
        };
        const key = JSON.stringify(identity);
        if (key !== '{}' && key !== tiktokUser) {
          tiktokUser = key;
          ttq.identify(identity);
        }
        if (event.name === 'PageView') ttq.page();
        else ttq.track(event.name, data, { event_id: event.id });
      }
    }
  });
  parent.postMessage({ type: 'pb-ad-ready' }, location.origin);
})();
</script>`;

const inlineScript = html.slice(
  html.indexOf("<script>") + 8,
  html.lastIndexOf("</script>"),
);
const scriptHash = createHash("sha256").update(inlineScript).digest("base64");

export function GET() {
  return new Response(html, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'sha256-" +
        scriptHash +
        "' https://connect.facebook.net https://analytics.tiktok.com; img-src https://www.facebook.com https://analytics.tiktok.com https://*.tiktok.com data:; connect-src https://*.facebook.com https://*.tiktok.com; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
