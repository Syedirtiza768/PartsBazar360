/**
 * eBay store adapter — discovers every listing URL of an eBay store.
 *
 * Coverage strategy (three sweeps, all checkpointed):
 *  1. Store pagination: /str/{store}?_ipg=N&_pgn=p
 *  2. Store-scoped keyword search: /sch/i.html with the store seller filter.
 *     Catches listings the storefront paginator hides past its page cap.
 *  3. Sort-order rotation (optional): the same queries under different
 *     _sop orderings surface different slices of large result sets.
 *
 * Extraction fuses DOM selectors with raw-HTML regexes (listingId / itemId
 * JSON fields), which survives eBay A/B markup changes.
 */

export const DEFAULT_KEYWORDS = [
  'engine', 'gearbox', 'transmission', 'headlight', 'bumper', 'door',
  'mirror', 'seat', 'wheel', 'brake', 'suspension', 'radiator',
  'alternator', 'starter', 'turbo', 'exhaust', 'fuel pump', 'sensor',
  'ECU', 'wiring', 'grille', 'fender', 'hood', 'trunk',
  'Mercedes', 'BMW', 'Audi', 'Volkswagen', 'Porsche', 'Lexus',
  'Toyota', 'Honda', 'Ford', 'Chevrolet', 'Dodge', 'Jeep',
  'Land Rover', 'Jaguar', 'Volvo', 'Mini', 'Maserati', 'Cadillac',
  'C350', 'E350', 'ML350', '335i', '528i', 'X5',
  'A4', 'A6', 'Q5', 'Q7', 'TT',
  'Golf', 'Jetta', 'Passat', 'Tiguan',
  'Cayenne', 'Panamera', '911',
  'IS250', 'RX350', 'LS460',
  'Camry', 'Civic', 'Mustang', 'Camaro', 'Charger',
  'Range Rover', 'Evoque', 'XF',
  'XC60', 'XC90', 'Cooper', 'Ghibli', 'CTS', 'Escalade',
];

const ID_PATTERNS = [
  /\/itm\/(\d{10,15})/g,
  /"listingId":"(\d{10,15})"/g,
  /"itemId":"(\d{10,15})"/g,
];

export function extractIdsFromHtml(html) {
  const ids = new Set();
  if (!html) return [];
  for (const re of ID_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
  }
  return [...ids];
}

export function ebayStoreAdapter({
  store,
  sellerUsername,                 // eBay seller username for store-scoped search (_ssn)
  ipg = 240,
  maxStorePages = 200,
  keywords = DEFAULT_KEYWORDS,
  maxKeywordPages = 20,
  includeKeywords = true,
  expectedPerPage = 10,           // conservative floor for yield-anomaly detection
} = {}) {
  if (!store) throw new Error('ebayStoreAdapter: `store` (storefront slug, e.g. "salvagea") is required');
  const origin = 'https://www.ebay.com';
  const storeBase = `${origin}/str/${store}`;

  function buildQueue() {
    const queue = [];
    for (let pg = 1; pg <= maxStorePages; pg++) {
      queue.push({
        key: `store:pgn=${pg}`,
        url: `${storeBase}?_ipg=${ipg}&_pgn=${pg}`,
        meta: { phase: 'store', page: pg },
      });
    }
    if (includeKeywords) {
      for (const kw of keywords) {
        for (let pg = 1; pg <= maxKeywordPages; pg++) {
          const params = new URLSearchParams({
            _dkr: '1', iconV2Request: 'true', _blrs: 'recall_filtering',
            _ssn: sellerUsername || store, store_cat: '0', store_name: store,
            _oac: '1', _ipg: String(ipg), _pgn: String(pg), _nkw: kw,
          });
          queue.push({
            key: `kw:${kw}:pgn=${pg}`,
            url: `${origin}/sch/i.html?${params.toString()}`,
            meta: { phase: 'keyword', keyword: kw, page: pg },
          });
        }
      }
    }
    return queue;
  }

  return {
    name: `ebay-store:${store}`,
    warmupUrl: `${origin}/`,
    buildQueue,

    /** Conservative yield floor; legitimately-empty pages are resolved by the dead-letter sweep. */
    expectedMin: () => expectedPerPage,
    allowEmpty: () => false,

    extractFromHtml(html) {
      return extractIdsFromHtml(html);
    },

    async extractFromPage(page) {
      try {
        return await page.evaluate((patterns) => {
          const ids = new Set();
          document.querySelectorAll('a[href*="/itm/"]').forEach((a) => {
            const m = a.href.match(/\/itm\/(\d{10,15})/);
            if (m) ids.add(m[1]);
          });
          const html = document.body ? document.body.innerHTML : '';
          for (const src of patterns) {
            const re = new RegExp(src, 'g');
            let m;
            while ((m = re.exec(html)) !== null) ids.add(m[1]);
          }
          return [...ids];
        }, ID_PATTERNS.map((r) => r.source));
      } catch {
        return [];
      }
    },

    /** Parse "26,758 results" style totals when present (for progress reporting). */
    parseTotal(html) {
      const m = html?.match(/([\d,]+)\s*(?:Results|results|Ergebnisse)/);
      return m ? Number(m[1].replace(/,/g, '')) : null;
    },

    toListingUrl(id) {
      return `${origin}/itm/${id}`;
    },
  };
}
