import { createHash } from 'node:crypto';

export type Vendor = 'meta' | 'tiktok';
export type CatalogKey = 'partId' | 'offerId';
export type ConversionName =
  'AddToCart' | 'InitiateCheckout' | 'Purchase' | 'Lead';

export type AdvertisingItem = {
  partId?: string;
  offerId?: string;
  name?: string;
  price: number;
  quantity: number;
};

export type Conversion = {
  name: ConversionName;
  id: string;
  currency?: string;
  value?: number;
  items?: AdvertisingItem[];
};

export type AdvertisingContext = {
  consentId: string;
  ip?: string;
  agent?: string;
  fbp?: string;
  fbc?: string;
  ttp?: string;
  ttclid?: string;
  user?: MatchUser;
};

/**
 * Advanced-matching identifiers. Every value is a SHA-256 hex digest of the
 * vendor-normalized field; raw customer details are never stored or sent.
 * `ph` is the digits-only form Meta expects, `phE164` the `+`-prefixed form
 * TikTok expects.
 */
export type MatchUser = {
  em?: string;
  ph?: string;
  phE164?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  zp?: string;
  country?: string;
  external_id?: string;
};

export type CustomerDetails = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  externalId?: string | null;
};

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const letters = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}]/gu, '');

/** Normalize and hash customer details per Meta/TikTok advanced-matching rules. */
export function matchUser(details: CustomerDetails): MatchUser | undefined {
  const user: MatchUser = {};
  const email = details.email?.trim().toLowerCase();
  // Guest placeholders like <phone>@guest.partsbazar360.com identify nobody.
  if (
    email &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !email.endsWith('@guest.partsbazar360.com')
  )
    user.em = sha256(email);
  const phone = details.phone?.trim();
  // Only a number that already carries its country code can be matched.
  const digits = phone?.replace(/\D/g, '') ?? '';
  if (
    phone &&
    (phone.startsWith('+') || phone.startsWith('00')) &&
    digits.length >= 8
  ) {
    const national = phone.startsWith('00') ? digits.slice(2) : digits;
    user.ph = sha256(national);
    user.phE164 = sha256('+' + national);
  }
  const parts = (details.name ?? '').trim().split(/\s+/).map(letters);
  const named = parts.filter(Boolean);
  if (named.length) user.fn = sha256(named[0]);
  if (named.length > 1) user.ln = sha256(named[named.length - 1]);
  const city = letters(details.city ?? '');
  if (city) user.ct = sha256(city);
  const zip = (details.postalCode ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (zip) user.zp = sha256(zip);
  const country = details.country?.trim().toLowerCase();
  if (country && /^[a-z]{2}$/.test(country)) user.country = sha256(country);
  const externalId = details.externalId?.trim();
  if (externalId) user.external_id = sha256(externalId);
  return Object.keys(user).length ? user : undefined;
}

/** Add hashed customer details to a context; earlier non-empty values win. */
export function withCustomer(
  context: AdvertisingContext,
  ...details: Array<CustomerDetails | null | undefined>
): AdvertisingContext {
  const user: MatchUser = {};
  for (const detail of details) {
    const hashed = detail && matchUser(detail);
    if (!hashed) continue;
    for (const [key, value] of Object.entries(hashed) as Array<
      [keyof MatchUser, string]
    >) {
      user[key] ??= value;
    }
  }
  const merged = { ...user, ...context.user };
  return Object.keys(merged).length ? { ...context, user: merged } : context;
}

export type Destination = { catalogKey: CatalogKey; currencies: string[] };

const pages: Record<ConversionName, string> = {
  AddToCart: '/buyer/parts/',
  InitiateCheckout: '/buyer/checkout/',
  Purchase: '/buyer/checkout/success/',
  Lead: '/buyer/support/',
};

export function marketingOrigin(): string {
  return new URL(process.env.BUYER_APP_URL || 'https://partsbazar360.com/buyer')
    .origin;
}

export function destination(vendor: Vendor): Destination | undefined {
  if (process.env.ADVERTISING_ENABLED !== '1') return;
  const prefix = vendor.toUpperCase();
  const catalogKey = process.env[`ADVERTISING_${prefix}_CATALOG_KEY`];
  const currencies = (process.env[`ADVERTISING_${prefix}_CURRENCIES`] || '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => /^[A-Z]{3}$/.test(code));
  if (
    process.env[`ADVERTISING_${prefix}_CONFIGURED`] !== '1' ||
    (vendor === 'meta' &&
      !/^v\d+\.\d+$/.test(process.env.ADVERTISING_META_VERSION || '')) ||
    (catalogKey !== 'partId' && catalogKey !== 'offerId') ||
    currencies.length === 0
  )
    return;
  return { catalogKey, currencies };
}

export function conversionProperties(
  event: Conversion,
  config: Destination,
  vendor: Vendor,
) {
  if (event.name === 'Lead' && !event.items?.length) {
    return { content_category: 'freight_quote' };
  }
  const { currency, value, items } = event;
  if (
    !currency ||
    !config.currencies.includes(currency) ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !items?.length ||
    items.some(
      (item) =>
        !item[config.catalogKey] ||
        !Number.isFinite(item.price) ||
        item.price < 0 ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1,
    )
  )
    return;
  const contents = items.map((item) =>
    vendor === 'meta'
      ? {
          id: item[config.catalogKey],
          quantity: item.quantity,
          item_price: item.price,
        }
      : {
          content_id: item[config.catalogKey],
          content_type: 'product',
          content_name: item.name,
          price: item.price,
          quantity: item.quantity,
        },
  );
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    currency,
    value,
    contents,
    content_type: 'product',
    ...(vendor === 'meta'
      ? {
          content_ids: items.map((item) => item[config.catalogKey]),
          num_items: quantity,
        }
      : { quantity }),
    ...(event.name === 'Lead' ? { content_category: 'freight_quote' } : {}),
  };
}

export function conversionPayload(
  event: Conversion,
  vendor: Vendor,
  config: Destination,
  context: AdvertisingContext,
  createdAt: Date,
) {
  const properties = conversionProperties(event, config, vendor);
  if (!properties) return;
  const event_time = Math.floor(createdAt.getTime() / 1000);
  const event_id = event.id;
  const page = marketingOrigin() + pages[event.name];
  const user = context.user ?? {};
  const list = (value?: string) => (value ? [value] : undefined);
  if (vendor === 'meta') {
    const user_data = {
      em: list(user.em),
      ph: list(user.ph),
      fn: list(user.fn),
      ln: list(user.ln),
      ct: list(user.ct),
      zp: list(user.zp),
      country: list(user.country),
      external_id: list(user.external_id),
      client_ip_address: context.ip,
      client_user_agent: context.agent,
      fbp: context.fbp,
      fbc: context.fbc,
    };
    return {
      data: [
        {
          event_name: event.name,
          event_time,
          event_id,
          action_source: 'website',
          event_source_url: page,
          user_data,
          custom_data: properties,
        },
      ],
      ...(process.env.ADVERTISING_META_TEST_CODE
        ? { test_event_code: process.env.ADVERTISING_META_TEST_CODE }
        : {}),
    };
  }
  return {
    event_source: 'web',
    event_source_id: 'DBS6C7RC77U657ENO7K0',
    ...(process.env.ADVERTISING_TIKTOK_TEST_CODE
      ? { test_event_code: process.env.ADVERTISING_TIKTOK_TEST_CODE }
      : {}),
    data: [
      {
        event: event.name,
        event_time,
        event_id,
        properties,
        page: { url: page },
        user: {
          email: user.em,
          phone: user.phE164,
          external_id: user.external_id,
          ip: context.ip,
          user_agent: context.agent,
          ttp: context.ttp,
          ttclid: context.ttclid,
        },
      },
    ],
  };
}
