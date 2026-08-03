import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../email/email.service';
import { SendGridService } from '../email/sendgrid.service';
import { TwilioService } from '../sms/twilio.service';
import { MARKETPLACE_SELLERS } from '../seed/marketplace-sellers.config';

export type AuthRole = 'BUYER' | 'SELLER' | 'ADMIN';
export type SellerMemberRole = 'OWNER' | 'MANAGER' | 'STAFF';

export interface AuthTokenPayload {
  sub: string;
  email: string | null;
  role: AuthRole;
  sellerIds: string[];
  iat: number;
  exp: number;
}

export interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: string;
  memberships: Array<{ sellerId: string; sellerName: string; role: string }>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly sendGridService: SendGridService,
    private readonly twilioService: TwilioService,
  ) {}

  /** Normalizes to E.164 (assumes UAE if no country code is given, since that's the primary market). */
  private normalizePhone(phone: string): string {
    const parsed = parsePhoneNumberFromString(phone, 'AE');
    if (!parsed || !parsed.isValid()) {
      throw new BadRequestException('Enter a valid mobile number');
    }
    return parsed.number;
  }

  private jwtSecret() {
    return (
      process.env.AUTH_JWT_SECRET ||
      process.env.JWT_SECRET ||
      'partsbazar-dev-secret-change-me'
    );
  }

  hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  verifyPassword(password: string, stored: string): boolean {
    const [algo, salt, hash] = stored.split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }

  signToken(
    payload: Omit<AuthTokenPayload, 'iat' | 'exp'>,
    ttlSeconds = 60 * 60 * 24 * 7,
  ): string {
    const body: AuthTokenPayload = {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    const sig = createHmac('sha256', this.jwtSecret())
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${sig}`;
  }

  verifyToken(token: string): AuthTokenPayload {
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) throw new UnauthorizedException('Invalid token');
    const expected = createHmac('sha256', this.jwtSecret())
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid token signature');
    }
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as AuthTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired');
    }
    return payload;
  }

  private async toPublicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          include: { seller: { select: { id: true, name: true } } },
        },
      },
    });
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: user.role,
      memberships: user.memberships.map((m) => ({
        sellerId: m.sellerId,
        sellerName: m.seller.name,
        role: m.role,
      })),
    };
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });
    if (
      !user?.passwordHash ||
      !this.verifyPassword(input.password, user.passwordHash)
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const role = (user.role as AuthRole) || 'BUYER';
    const sellerIds =
      role === 'ADMIN'
        ? Object.values(MARKETPLACE_SELLERS).map((s) => s.id)
        : user.memberships.map((m) => m.sellerId);

    const publicUser = await this.toPublicUser(user.id);
    return {
      user: publicUser,
      accessToken: this.signToken({
        sub: user.id,
        email: user.email,
        role,
        sellerIds,
      }),
    };
  }

  async me(token: string) {
    const payload = this.verifyToken(token);
    return this.toPublicUser(payload.sub);
  }

  async registerBuyer(input: {
    email: string;
    password: string;
    name?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    if (!email || !input.password || input.password.length < 8) {
      throw new BadRequestException(
        'Email and password (min 8 chars) are required',
      );
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.passwordHash) {
      throw new BadRequestException(
        'An account with this email already exists',
      );
    }

    const verifyToken = randomBytes(32).toString('hex');
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: this.hashPassword(input.password),
            name: input.name || existing.name,
            role: existing.role === 'ADMIN' ? 'ADMIN' : 'BUYER',
            emailVerified: false,
            emailVerifyToken: verifyToken,
            emailVerifyExpiry: verifyExpiry,
          },
        })
      : await this.prisma.user.create({
          data: {
            email,
            name: input.name || null,
            role: 'BUYER',
            passwordHash: this.hashPassword(input.password),
            emailVerified: false,
            emailVerifyToken: verifyToken,
            emailVerifyExpiry: verifyExpiry,
          },
        });

    void this.emailService
      .sendEmailVerification(email, verifyToken)
      .catch(() => {});

    const publicUser = await this.toPublicUser(user.id);
    return {
      user: publicUser,
      accessToken: this.signToken({
        sub: user.id,
        email: user.email,
        role: 'BUYER',
        sellerIds: [],
      }),
      emailVerificationSent: true,
    };
  }

  async verifyEmail(token: string) {
    if (!token) throw new BadRequestException('Verification token is required');

    const user = await this.prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
        emailVerifyExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpiry: null,
      },
    });

    return { message: 'Email verified successfully' };
  }

  /**
   * Sends the checkout phone OTP and reports whether the number already has
   * an account, so the buyer-marketplace client knows whether to offer the
   * "create an account" password prompt alongside the code field.
   */
  async sendPhoneOtp(phone: string): Promise<{ exists: boolean }> {
    const normalizedPhone = this.normalizePhone(phone);

    const existing = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
    });

    await this.twilioService.startVerification(normalizedPhone);

    return { exists: Boolean(existing) };
  }

  async verifyPhoneOtp(phone: string, code: string, password?: string) {
    const normalizedPhone = this.normalizePhone(phone);
    if (!code) {
      throw new BadRequestException('Verification code is required');
    }

    const approved = await this.twilioService.checkVerification(
      normalizedPhone,
      code,
    );
    if (!approved) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const existing = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
      include: { memberships: true },
    });

    // Returning numbers never get a password prompt, so any `password` here
    // only applies to brand-new accounts.
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { phoneVerified: true },
          include: { memberships: true },
        })
      : await this.prisma.user.create({
          data: {
            phone: normalizedPhone,
            phoneVerified: true,
            role: 'BUYER',
            passwordHash: password ? this.hashPassword(password) : null,
          },
          include: { memberships: true },
        });

    const role = (user.role as AuthRole) || 'BUYER';
    const sellerIds =
      role === 'ADMIN'
        ? Object.values(MARKETPLACE_SELLERS).map((s) => s.id)
        : user.memberships.map((m) => m.sellerId);

    const publicUser = await this.toPublicUser(user.id);
    return {
      user: publicUser,
      accessToken: this.signToken({
        sub: user.id,
        email: user.email,
        role,
        sellerIds,
      }),
    };
  }

  /**
   * Email-via-SendGrid fallback for checkout verification while Twilio SMS
   * is unavailable. Mirrors sendPhoneOtp/verifyPhoneOtp but keyed by email,
   * reusing the otpCode/otpExpiry columns the old email-OTP flow left behind.
   */
  async sendEmailOtp(email: string): Promise<{ exists: boolean }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new BadRequestException('Email is required');
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // The code has to be persisted somewhere to verify against later, so a
    // brand-new email still gets a bare (unverified) User row created now —
    // same shape as the old email-OTP flow this replaces for the moment.
    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { otpCode: code, otpExpiry },
      });
    } else {
      await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          role: 'BUYER',
          otpCode: code,
          otpExpiry,
        },
      });
    }

    await this.sendGridService.sendOtpCode(normalizedEmail, code);

    return { exists: Boolean(existing) };
  }

  async verifyEmailOtp(
    email: string,
    code: string,
    phone?: string,
    password?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !code) {
      throw new BadRequestException('Email and code are required');
    }
    const normalizedPhone = phone ? this.normalizePhone(phone) : undefined;

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { memberships: true },
    });

    if (
      !existing ||
      existing.otpCode !== code ||
      !existing.otpExpiry ||
      existing.otpExpiry < new Date()
    ) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Whether this was a pre-existing account or the bare row sendEmailOtp
    // just created, the "new account?" password only applies the first time
    // a password isn't already set — returning users keep their own.
    const user = await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        otpCode: null,
        otpExpiry: null,
        emailVerified: true,
        phone: existing.phone ?? normalizedPhone,
        passwordHash: existing.passwordHash
          ? existing.passwordHash
          : password
            ? this.hashPassword(password)
            : null,
      },
      include: { memberships: true },
    });

    const role = (user.role as AuthRole) || 'BUYER';
    const sellerIds =
      role === 'ADMIN'
        ? Object.values(MARKETPLACE_SELLERS).map((s) => s.id)
        : user.memberships.map((m) => m.sellerId);

    const publicUser = await this.toPublicUser(user.id);
    return {
      user: publicUser,
      accessToken: this.signToken({
        sub: user.id,
        email: user.email,
        role,
        sellerIds,
      }),
    };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new BadRequestException('Email is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user) {
      const resetToken = randomBytes(32).toString('hex');
      const resetExpiry = new Date(Date.now() + 60 * 60 * 1000);

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: resetToken,
          passwordResetExpiry: resetExpiry,
        },
      });

      void this.emailService
        .sendPasswordReset(normalizedEmail, resetToken)
        .catch(() => {});
    }

    return {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };
  }

  async resetPassword(token: string, newPassword: string) {
    if (!token) throw new BadRequestException('Reset token is required');
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: this.hashPassword(newPassword),
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });

    return { message: 'Password reset successfully' };
  }

  /**
   * Seed: 1 admin + 3 logins per seller (owner/manager/staff) + 1 demo buyer.
   * Default password from SEED_AUTH_PASSWORD or "ChangeMe123!".
   */
  async seedMarketplaceUsers() {
    const password = process.env.SEED_AUTH_PASSWORD || 'ChangeMe123!';
    const passwordHash = this.hashPassword(password);
    const created: Array<{ email: string; role: string; seller?: string }> = [];

    const adminEmail = (
      process.env.SEED_ADMIN_EMAIL || 'admin@partsbazar360.com'
    ).toLowerCase();
    await this.prisma.user.upsert({
      where: { email: adminEmail },
      update: { role: 'ADMIN', passwordHash, name: 'Marketplace Admin' },
      create: {
        email: adminEmail,
        name: 'Marketplace Admin',
        role: 'ADMIN',
        passwordHash,
      },
    });
    created.push({ email: adminEmail, role: 'ADMIN' });

    const buyerEmail = (
      process.env.SEED_BUYER_EMAIL || 'buyer@partsbazar360.com'
    ).toLowerCase();
    await this.prisma.user.upsert({
      where: { email: buyerEmail },
      update: { role: 'BUYER', passwordHash, name: 'Demo Buyer' },
      create: {
        email: buyerEmail,
        name: 'Demo Buyer',
        role: 'BUYER',
        passwordHash,
      },
    });
    created.push({ email: buyerEmail, role: 'BUYER' });

    const staffRoles: SellerMemberRole[] = ['OWNER', 'MANAGER', 'STAFF'];
    for (const cfg of Object.values(MARKETPLACE_SELLERS)) {
      const seller = await this.prisma.seller.findFirst({
        where: {
          OR: [
            { id: cfg.id },
            ...(cfg.storeId ? [{ storeId: cfg.storeId }] : []),
            { name: cfg.name },
          ],
        },
      });
      if (!seller) {
        created.push({
          email: `(missing seller ${cfg.name})`,
          role: 'SKIPPED',
        });
        continue;
      }

      for (const memberRole of staffRoles) {
        const slug = cfg.key;
        const email = `${slug}.${memberRole.toLowerCase()}@partsbazar360.com`;
        const user = await this.prisma.user.upsert({
          where: { email },
          update: {
            role: 'SELLER',
            passwordHash,
            name: `${cfg.name} ${memberRole}`,
          },
          create: {
            email,
            name: `${cfg.name} ${memberRole}`,
            role: 'SELLER',
            passwordHash,
          },
        });
        await this.prisma.sellerMembership.upsert({
          where: { userId_sellerId: { userId: user.id, sellerId: seller.id } },
          update: { role: memberRole },
          create: { userId: user.id, sellerId: seller.id, role: memberRole },
        });
        created.push({ email, role: memberRole, seller: seller.name });
      }
    }

    return { defaultPassword: password, users: created };
  }
}
