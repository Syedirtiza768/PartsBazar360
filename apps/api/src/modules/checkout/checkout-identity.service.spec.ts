/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { CheckoutIdentityService } from './checkout-identity.service';

describe('CheckoutIdentityService', () => {
  function build() {
    let challenge: any;
    let sentCode = '';
    const session = {
      id: 'checkout-1',
      cartId: 'cart-1',
      status: 'ACTIVE',
      phoneNormalized: '+971501234567',
      cart: { status: 'ACTIVE' },
    };
    const customer = {
      id: 'customer-1',
      phoneNormalized: '+971501234567',
      phoneVerifiedAt: new Date(),
    };
    const user = {
      id: 'user-1',
      phone: '+971501234567',
      customerId: null,
      passwordHash: 'scrypt$salt$hash',
      name: 'Returning Buyer',
      email: null,
    };
    const prisma: any = {
      checkoutSession: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(session)),
        update: jest.fn().mockResolvedValue(session),
      },
      phoneVerificationChallenge: {
        findFirst: jest
          .fn()
          .mockImplementation(() => Promise.resolve(challenge ?? null)),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) => {
          challenge = {
            ...data,
            attempts: 0,
            maxAttempts: 5,
            lastSentAt: new Date(),
            consumedAt: null,
            deliveryStatus: 'SENT',
            createdAt: new Date(),
          };
          return Promise.resolve(challenge);
        }),
        update: jest.fn().mockImplementation(({ data }) => {
          challenge = { ...challenge, ...data };
          return Promise.resolve(challenge);
        }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(customer),
        update: jest.fn().mockResolvedValue(customer),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest
          .fn()
          .mockResolvedValue({ ...user, customerId: customer.id }),
      },
      checkoutEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest
      .fn()
      .mockImplementation((input) =>
        Array.isArray(input) ? Promise.all(input) : input(prisma),
      );
    const sms = {
      sendOtpSms: jest.fn().mockImplementation((_phone, code) => {
        sentCode = code;
        return Promise.resolve();
      }),
    };
    const service = new CheckoutIdentityService(prisma, sms as any, {} as any);
    return {
      service,
      prisma,
      sms,
      getCode: () => sentCode,
      getChallenge: () => challenge,
    };
  }

  it('stores only a hash and does not disclose account existence before verification', async () => {
    const { service, getCode, getChallenge } = build();
    const result = await service.requestOtp(
      'checkout-1',
      '050 123 4567',
      '203.0.113.5',
      'test-device',
    );

    expect(result).toEqual(expect.objectContaining({ sent: true }));
    expect(result).not.toHaveProperty('accountExists');
    expect(result).not.toHaveProperty('code');
    expect(getCode()).toMatch(/^\d{6}$/);
    expect(getChallenge().codeHash).not.toContain(getCode());
  });

  it('reuses an existing phone owner without issuing an account login token', async () => {
    const { service, prisma, getCode } = build();
    await service.requestOtp('checkout-1', '+971501234567');
    const result = await service.verifyOtp('checkout-1', getCode());

    expect(result.verified).toBe(true);
    expect(result.checkoutToken).toEqual(expect.any(String));
    expect(result.accountExists).toBe(true);
    expect(result).not.toHaveProperty('accessToken');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ customerId: 'customer-1' }),
      }),
    );
  });

  it('preserves the challenge and increments attempts after an incorrect code', async () => {
    const { service, getChallenge } = build();
    await service.requestOtp('checkout-1', '+971501234567');

    await expect(service.verifyOtp('checkout-1', '000000')).rejects.toThrow(
      /incorrect/i,
    );
    expect(getChallenge().attempts).toBe(1);
    expect(getChallenge().consumedAt).toBeNull();
  });
});
