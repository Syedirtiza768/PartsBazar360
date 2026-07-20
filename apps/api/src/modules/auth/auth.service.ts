import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { MARKETPLACE_SELLERS } from '../seed/marketplace-sellers.config';

export type AuthRole = 'BUYER' | 'SELLER' | 'ADMIN';
export type SellerMemberRole = 'OWNER' | 'MANAGER' | 'STAFF';

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: AuthRole;
  sellerIds: string[];
  iat: number;
  exp: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  memberships: Array<{ sellerId: string; sellerName: string; role: string }>;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private jwtSecret() {
    return process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || 'partsbazar-dev-secret-change-me';
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

  signToken(payload: Omit<AuthTokenPayload, 'iat' | 'exp'>, ttlSeconds = 60 * 60 * 24 * 7): string {
    const body: AuthTokenPayload = {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    const sig = createHmac('sha256', this.jwtSecret()).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  verifyToken(token: string): AuthTokenPayload {
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) throw new UnauthorizedException('Invalid token');
    const expected = createHmac('sha256', this.jwtSecret()).update(encoded).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid token signature');
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired');
    }
    return payload;
  }

  private async toPublicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: { include: { seller: { select: { id: true, name: true } } } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      memberships: user.memberships.map((m) => ({
        sellerId: m.sellerId,
        sellerName: m.seller.name,
        role: m.role,
      })),
    };
  }

  async registerBuyer(input: { email: string; password: string; name?: string }) {
    const email = input.email.trim().toLowerCase();
    if (!email || !input.password || input.password.length < 8) {
      throw new BadRequestException('Email and password (min 8 chars) are required');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.passwordHash) {
      throw new BadRequestException('An account with this email already exists');
    }

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: this.hashPassword(input.password),
            name: input.name || existing.name,
            role: existing.role === 'ADMIN' ? 'ADMIN' : 'BUYER',
          },
        })
      : await this.prisma.user.create({
          data: {
            email,
            name: input.name || null,
            role: 'BUYER',
            passwordHash: this.hashPassword(input.password),
          },
        });

    const publicUser = await this.toPublicUser(user.id);
    return {
      user: publicUser,
      accessToken: this.signToken({
        sub: user.id,
        email: user.email,
        role: 'BUYER',
        sellerIds: [],
      }),
    };
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });
    if (!user?.passwordHash || !this.verifyPassword(input.password, user.passwordHash)) {
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

  /**
   * Seed: 1 admin + 3 logins per seller (owner/manager/staff) + 1 demo buyer.
   * Default password from SEED_AUTH_PASSWORD or "ChangeMe123!".
   */
  async seedMarketplaceUsers() {
    const password = process.env.SEED_AUTH_PASSWORD || 'ChangeMe123!';
    const passwordHash = this.hashPassword(password);
    const created: Array<{ email: string; role: string; seller?: string }> = [];

    const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@partsbazar360.com').toLowerCase();
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

    const buyerEmail = (process.env.SEED_BUYER_EMAIL || 'buyer@partsbazar360.com').toLowerCase();
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
        created.push({ email: `(missing seller ${cfg.name})`, role: 'SKIPPED' });
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
