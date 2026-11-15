import { createHash } from 'node:crypto';
import {
  conversionPayload,
  matchUser,
  withCustomer,
  type Conversion,
} from './advertising-payload';

const sha = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const event: Conversion = {
  name: 'Purchase',
  id: 'order_sample',
  currency: 'AED',
  value: 100,
  items: [{ partId: 'part-8', offerId: 'offer-3', quantity: 2, price: 50 }],
};
const config = { catalogKey: 'partId' as const, currencies: ['AED'] };
const base = { consentId: '9e0d950e-8874-4f5e-a631-861827d0d343' };
const date = new Date('2026-11-14T12:00:00.000Z');

describe('advertising advanced matching', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, ADVERTISING_META_VERSION: 'v27.0' };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('normalizes before hashing and never keeps raw values', () => {
    const user = matchUser({
      email: '  Ahmed@Example.COM ',
      phone: '+971 50-123 4567',
      name: "  Ahmed  O'Neil ",
      city: 'Abu Dhabi',
      postalCode: 'SW1A 1AA',
      country: 'AE',
      externalId: 'user-1',
    });
    expect(user).toEqual({
      em: sha('ahmed@example.com'),
      ph: sha('971501234567'),
      phE164: sha('+971501234567'),
      fn: sha('ahmed'),
      ln: sha('oneil'),
      ct: sha('abudhabi'),
      zp: sha('sw1a1aa'),
      country: sha('ae'),
      external_id: sha('user-1'),
    });
    for (const value of Object.values(user!)) {
      expect(value).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('skips placeholder emails, phones without a country code and non-ISO countries', () => {
    expect(
      matchUser({
        email: '971501234567@guest.partsbazar360.com',
        phone: '0501234567',
        country: 'United Arab Emirates',
      }),
    ).toBeUndefined();
    expect(matchUser({ phone: '00971501234567' })?.phE164).toBe(
      sha('+971501234567'),
    );
  });

  it('keeps earlier values and fills gaps when merging customer details', () => {
    const first = withCustomer(base, { email: 'a@x.com' });
    const merged = withCustomer(first, { email: 'b@x.com', name: 'Sara' });
    expect(merged.user).toEqual({ em: sha('a@x.com'), fn: sha('sara') });
    expect(withCustomer(base, null)).toBe(base);
  });

  it('sends hashed fields in each vendor format', () => {
    const context = withCustomer(base, {
      email: 'a@x.com',
      phone: '+971501234567',
      externalId: 'user-1',
    });
    const meta = conversionPayload(event, 'meta', config, context, date) as {
      data: Array<{ user_data: Record<string, unknown> }>;
    };
    expect(meta.data[0].user_data).toMatchObject({
      em: [sha('a@x.com')],
      ph: [sha('971501234567')],
      external_id: [sha('user-1')],
    });
    const tiktok = conversionPayload(event, 'tiktok', config, context, date) as {
      data: Array<{ user: Record<string, unknown> }>;
    };
    expect(tiktok.data[0].user).toMatchObject({
      email: sha('a@x.com'),
      phone: sha('+971501234567'),
      external_id: sha('user-1'),
    });
  });
});
