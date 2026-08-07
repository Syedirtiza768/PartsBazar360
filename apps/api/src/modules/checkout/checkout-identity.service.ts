import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { AuthService } from '../auth/auth.service';
import { maskPhone, normalizePhone } from '../auth/phone.util';
import { SmsGlobalService } from '../sms/smsglobal.service';

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 45 * 1000;
const OTP_RATE_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_SENDS_PER_PHONE = 5;
const OTP_MAX_SENDS_PER_IP = 20;
const CHECKOUT_TOKEN_EXPIRY_MS = 2 * 60 * 60 * 1000;

const ALLOWED_EVENTS = new Set([
  'checkout_started',
  'phone_entered',
  'otp_requested',
  'otp_verified',
  'otp_failed',
  'contact_completed',
  'delivery_completed',
  'payment_started',
  'payment_failed',
  'order_completed',
  'account_creation_shown',
  'account_created',
  'account_creation_skipped',
]);

const ALLOWED_METADATA_KEYS = new Set([
  'provider',
  'reason',
  'retry',
  'step',
  'itemCount',
  'currency',
  'existingCustomer',
]);

@Injectable()
export class CheckoutIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsGlobalService,
    private readonly auth: AuthService,
  ) {}

  async createSession(cartId: string, draft?: Record<string, unknown>) {
    const cart = await this.prisma.cart.findUnique({ where: { id: cartId } });
    if (!cart || cart.status !== 'ACTIVE') {
      throw new BadRequestException('This cart is no longer available');
    }

    const session = await this.prisma.checkoutSession.create({
      data: {
        cartId,
        draft: this.cleanDraft(draft),
      },
    });
    await this.trackEvent(session.id, 'checkout_started');
    return { checkoutSessionId: session.id, status: session.status };
  }

  async updateDraft(checkoutSessionId: string, draft: Record<string, unknown>) {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: checkoutSessionId },
    });
    if (!session || session.status !== 'ACTIVE') {
      throw new BadRequestException('Checkout session is no longer active');
    }
    await this.prisma.checkoutSession.update({
      where: { id: session.id },
      data: { draft: this.cleanDraft(draft) },
    });
    return { saved: true };
  }

  async requestOtp(
    checkoutSessionId: string,
    phone: string,
    requestIp?: string,
    userAgent?: string,
  ) {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: checkoutSessionId },
      include: { cart: { select: { status: true } } },
    });
    if (
      !session ||
      session.status !== 'ACTIVE' ||
      session.cart.status !== 'ACTIVE'
    ) {
      throw new BadRequestException('Checkout session is no longer active');
    }

    const phoneNormalized = normalizePhone(phone);
    const now = new Date();
    const windowStart = new Date(now.getTime() - OTP_RATE_WINDOW_MS);
    const requestIpHash = requestIp ? this.hashPrivateValue(requestIp) : null;
    const deviceHash = userAgent ? this.hashPrivateValue(userAgent) : null;

    const [latest, phoneSends, ipSends] = await Promise.all([
      this.prisma.phoneVerificationChallenge.findFirst({
        where: { checkoutSessionId, deliveryStatus: 'SENT' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.phoneVerificationChallenge.count({
        where: { phoneNormalized, createdAt: { gte: windowStart } },
      }),
      requestIpHash
        ? this.prisma.phoneVerificationChallenge.count({
            where: { requestIpHash, createdAt: { gte: windowStart } },
          })
        : Promise.resolve(0),
    ]);

    if (
      latest &&
      now.getTime() - latest.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      const retryAfter = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS -
          (now.getTime() - latest.lastSentAt.getTime())) /
          1000,
      );
      throw new HttpException(
        `Please wait ${retryAfter} seconds before requesting another code`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      phoneSends >= OTP_MAX_SENDS_PER_PHONE ||
      ipSends >= OTP_MAX_SENDS_PER_IP
    ) {
      throw new HttpException(
        'Too many verification requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(100000, 1000000));
    const challengeId = randomUUID();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    await this.prisma.$transaction([
      this.prisma.phoneVerificationChallenge.updateMany({
        where: { checkoutSessionId, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.phoneVerificationChallenge.create({
        data: {
          id: challengeId,
          checkoutSessionId,
          phoneNormalized,
          codeHash: this.hashOtp(challengeId, phoneNormalized, code),
          expiresAt,
          requestIpHash,
          deviceHash,
        },
      }),
      this.prisma.checkoutSession.update({
        where: { id: checkoutSessionId },
        data: {
          phoneNormalized,
          phoneVerifiedAt: null,
          customerId: null,
          checkoutTokenHash: null,
          tokenExpiresAt: null,
        },
      }),
    ]);

    try {
      await this.sms.sendOtpSms(phoneNormalized, code);
      await this.prisma.phoneVerificationChallenge.update({
        where: { id: challengeId },
        data: { deliveryStatus: 'SENT' },
      });
    } catch {
      await this.prisma.phoneVerificationChallenge.update({
        where: { id: challengeId },
        data: { deliveryStatus: 'FAILED', consumedAt: new Date() },
      });
      await this.trackEvent(checkoutSessionId, 'otp_failed', {
        reason: 'provider_unavailable',
      });
      throw new ServiceUnavailableException(
        'We could not send the code right now. Your checkout details are safe; please try again.',
      );
    }

    await this.trackEvent(checkoutSessionId, 'otp_requested');
    return {
      sent: true,
      maskedPhone: maskPhone(phoneNormalized),
      expiresInSeconds: OTP_EXPIRY_MS / 1000,
      resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    };
  }

  async verifyOtp(checkoutSessionId: string, code: string) {
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('Enter the 6-digit code');
    }
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: checkoutSessionId },
    });
    if (!session || session.status !== 'ACTIVE' || !session.phoneNormalized) {
      throw new BadRequestException('Request a new verification code');
    }
    const challenge = await this.prisma.phoneVerificationChallenge.findFirst({
      where: {
        checkoutSessionId,
        phoneNormalized: session.phoneNormalized,
        deliveryStatus: 'SENT',
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      throw new BadRequestException('Request a new verification code');
    }
    if (challenge.expiresAt <= new Date()) {
      await this.prisma.phoneVerificationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      await this.trackEvent(checkoutSessionId, 'otp_failed', {
        reason: 'expired',
      });
      throw new BadRequestException(
        'That code has expired. Request a new one.',
      );
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      throw new HttpException(
        'Too many incorrect attempts. Request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(
      this.hashOtp(challenge.id, challenge.phoneNormalized, code),
      'hex',
    );
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      const attempts = challenge.attempts + 1;
      await this.prisma.phoneVerificationChallenge.update({
        where: { id: challenge.id },
        data: {
          attempts,
          ...(attempts >= challenge.maxAttempts
            ? { consumedAt: new Date() }
            : {}),
        },
      });
      await this.trackEvent(checkoutSessionId, 'otp_failed', {
        reason: 'incorrect',
      });
      throw new BadRequestException(
        attempts >= challenge.maxAttempts
          ? 'Too many incorrect attempts. Request a new code.'
          : 'That code is incorrect. Try again.',
      );
    }

    const now = new Date();
    const rawToken = randomBytes(32).toString('base64url');
    const tokenExpiresAt = new Date(now.getTime() + CHECKOUT_TOKEN_EXPIRY_MS);
    const phoneNormalized = challenge.phoneNormalized;

    const customer = await this.prisma.$transaction(async (tx) => {
      let resolved = await tx.customer.findUnique({
        where: { phoneNormalized },
      });
      let existingUser = await tx.user.findUnique({
        where: { phone: phoneNormalized },
      });
      if (!existingUser) {
        const candidates = await tx.user.findMany({
          where: { phone: { endsWith: phoneNormalized.slice(-7) } },
          take: 20,
        });
        existingUser =
          candidates.find((candidate) => {
            try {
              return candidate.phone
                ? normalizePhone(candidate.phone) === phoneNormalized
                : false;
            } catch {
              return false;
            }
          }) ?? null;
      }
      if (!resolved) {
        resolved = await tx.customer.create({
          data: {
            phoneNormalized,
            phoneVerifiedAt: now,
            name: existingUser?.name,
            email: existingUser?.email,
          },
        });
      } else {
        resolved = await tx.customer.update({
          where: { id: resolved.id },
          data: { phoneVerifiedAt: now },
        });
      }
      if (existingUser && !existingUser.customerId) {
        await tx.user.update({
          where: { id: existingUser.id },
          data: { customerId: resolved.id, phoneVerified: true },
        });
      }
      if (existingUser?.customerId && existingUser.customerId !== resolved.id) {
        throw new ConflictException(
          'This verified phone needs customer identity reconciliation before checkout can continue.',
        );
      }
      await tx.phoneVerificationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });
      await tx.checkoutSession.update({
        where: { id: checkoutSessionId },
        data: {
          customerId: resolved.id,
          phoneNormalized,
          phoneVerifiedAt: now,
          checkoutTokenHash: this.hashToken(rawToken),
          tokenExpiresAt,
        },
      });
      return resolved;
    });

    const account = await this.prisma.user.findUnique({
      where: { customerId: customer.id },
    });
    await this.trackEvent(checkoutSessionId, 'otp_verified');
    return {
      verified: true,
      checkoutToken: rawToken,
      tokenExpiresAt,
      maskedPhone: maskPhone(phoneNormalized),
      accountExists: Boolean(account?.passwordHash),
    };
  }

  async authorize(
    checkoutSessionId: string,
    rawToken: string | undefined,
    cartId?: string,
    allowOrdered = false,
  ) {
    if (!rawToken)
      throw new UnauthorizedException('Verify your phone to continue');
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: checkoutSessionId },
      include: { customer: true },
    });
    if (
      !session ||
      !session.customer ||
      !session.phoneVerifiedAt ||
      !session.checkoutTokenHash ||
      !session.tokenExpiresAt ||
      session.tokenExpiresAt <= new Date() ||
      (cartId && session.cartId !== cartId) ||
      (session.status !== 'ACTIVE' &&
        !(allowOrdered && session.status === 'ORDERED'))
    ) {
      throw new UnauthorizedException('Phone verification has expired');
    }
    const expected = Buffer.from(session.checkoutTokenHash, 'hex');
    const actual = Buffer.from(this.hashToken(rawToken), 'hex');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new UnauthorizedException('Invalid checkout verification');
    }
    return session;
  }

  async createAccount(
    checkoutSessionId: string,
    rawToken: string | undefined,
    password: string,
  ) {
    if (!password || password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const session = await this.authorize(
      checkoutSessionId,
      rawToken,
      undefined,
      true,
    );
    const order = await this.prisma.order.findUnique({
      where: { checkoutSessionId },
    });
    if (!order || order.status !== 'PAID') {
      throw new ConflictException(
        'Payment confirmation is still processing. Please try again in a moment.',
      );
    }
    const existing = await this.prisma.user.findUnique({
      where: { customerId: session.customerId! },
    });
    if (existing?.passwordHash) {
      return { created: false, accountExists: true };
    }

    const customer = session.customer!;
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: this.auth.hashPassword(password),
            phone: customer.phoneNormalized,
            phoneVerified: true,
            role: existing.role === 'ADMIN' ? 'ADMIN' : 'BUYER',
          },
        })
      : await this.prisma.user.create({
          data: {
            customerId: customer.id,
            phone: customer.phoneNormalized,
            phoneVerified: true,
            name: customer.name,
            role: 'BUYER',
            passwordHash: this.auth.hashPassword(password),
          },
        });

    await this.trackEvent(checkoutSessionId, 'account_created');
    return {
      created: true,
      ...(await this.auth.issueSessionForUser(user.id)),
    };
  }

  async trackEvent(
    checkoutSessionId: string | undefined,
    name: string,
    metadata?: Record<string, string | number | boolean>,
    deviceClass?: string,
  ) {
    if (!ALLOWED_EVENTS.has(name)) {
      throw new BadRequestException('Unsupported checkout event');
    }
    if (checkoutSessionId) {
      const exists = await this.prisma.checkoutSession.findUnique({
        where: { id: checkoutSessionId },
        select: { id: true },
      });
      if (!exists) return { accepted: false };
    }
    await this.prisma.checkoutEvent.create({
      data: {
        checkoutSessionId,
        name,
        deviceClass: deviceClass?.slice(0, 20),
        metadata: metadata ? this.cleanMetadata(metadata) : undefined,
      },
    });
    return { accepted: true };
  }

  private cleanDraft(draft?: Record<string, unknown>) {
    if (!draft) return undefined;
    const allowed = [
      'name',
      'email',
      'line1',
      'line2',
      'city',
      'region',
      'country',
      'postalCode',
      'deliveryInstructions',
      'paymentProvider',
    ];
    return Object.fromEntries(
      allowed
        .filter((key) => typeof draft[key] === 'string')
        .map((key) => [key, String(draft[key]).slice(0, 500)]),
    );
  }

  private cleanMetadata(metadata: Record<string, string | number | boolean>) {
    return Object.fromEntries(
      Object.entries(metadata)
        .filter(([key]) => ALLOWED_METADATA_KEYS.has(key))
        .filter(([, value]) =>
          ['string', 'number', 'boolean'].includes(typeof value),
        )
        .slice(0, 12)
        .map(([key, value]) => [key.slice(0, 40), value]),
    );
  }

  private otpSecret() {
    const secret =
      process.env.OTP_HASH_SECRET ||
      process.env.AUTH_JWT_SECRET ||
      process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'OTP verification is not configured',
      );
    }
    return secret || 'partsbazar-checkout-dev-secret';
  }

  private hashOtp(id: string, phone: string, code: string) {
    return createHmac('sha256', this.otpSecret())
      .update(`${id}:${phone}:${code}`)
      .digest('hex');
  }

  private hashToken(token: string) {
    return createHmac('sha256', this.otpSecret()).update(token).digest('hex');
  }

  private hashPrivateValue(value: string) {
    return createHash('sha256')
      .update(`${this.otpSecret()}:${value}`)
      .digest('hex');
  }
}
