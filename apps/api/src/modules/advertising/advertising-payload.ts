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
};

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
  if (vendor === 'meta') {
    const user_data = {
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
          ip: context.ip,
          user_agent: context.agent,
          ttp: context.ttp,
          ttclid: context.ttclid,
        },
      },
    ],
  };
}
