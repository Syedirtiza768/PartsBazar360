import {
  acknowledgmentsMatch,
  checkoutValidationFingerprint,
  publicCheckoutValidation,
} from './checkout-validation.util';

describe('checkout validation utilities', () => {
  it('fingerprints semantically identical canonical payloads consistently', () => {
    const payload = {
      cartId: 'cart-1',
      lines: [{ id: 'line-1', quantity: 2 }],
      country: 'AE',
    };
    expect(checkoutValidationFingerprint(payload)).toBe(
      checkoutValidationFingerprint(payload),
    );
    expect(checkoutValidationFingerprint(payload)).not.toBe(
      checkoutValidationFingerprint({ ...payload, country: 'GB' }),
    );
  });

  it('requires exact acknowledgment coverage with no duplicate or extra line IDs', () => {
    expect(
      acknowledgmentsMatch(['line-b', 'line-a'], ['line-a', 'line-b']),
    ).toBe(true);
    expect(acknowledgmentsMatch(['line-a', 'line-b'], ['line-a'])).toBe(false);
    expect(
      acknowledgmentsMatch(['line-a'], ['line-a', 'unverified-extra']),
    ).toBe(false);
    expect(acknowledgmentsMatch(['line-a'], ['line-a', 'line-a'])).toBe(false);
  });

  it('projects fitment decisions without exposing internal evidence provenance', () => {
    const result = publicCheckoutValidation({
      validationId: 'validation-1',
      policyVersion: 'policy-1',
      expiresAt: '2026-10-09T00:00:00.000Z',
      destinationCountry: 'UAE',
      shippingAvailable: true,
      blockingLineIds: [],
      requiredAcknowledgmentCartItemIds: ['line-1'],
      lines: [
        {
          cartItemId: 'line-1',
          quantity: 1,
          intendedVehicleConfigId: null,
          fitmentStatus: 'NO_VEHICLE',
          source: 'PRIVATE_SUPPLIER_FEED',
          verificationStatus: 'UNVERIFIED',
          shippingStatus: 'AVAILABLE',
          shippingReason: null,
        },
      ],
    });

    expect(result.lines[0]).toMatchObject({
      cartItemId: 'line-1',
      fitmentStatus: 'NO_VEHICLE',
      requiresAcknowledgment: true,
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SUPPLIER_FEED');
    expect(JSON.stringify(result)).not.toContain('verificationStatus');
  });
});
