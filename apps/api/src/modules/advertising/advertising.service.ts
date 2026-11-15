import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  conversionPayload,
  conversionProperties,
  destination,
  type AdvertisingContext,
  type Conversion,
  type Vendor,
} from './advertising-payload';

export const CONSENT_COOKIE = 'pb_advertising_consent';
export const CONSENT_SECONDS = 60 * 60 * 24 * 90;
const MAX_DELIVERY_AGE = 24 * 60 * 60 * 1000;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 6;
const vendors = ['meta', 'tiktok'] as const;

function cookie(
  req: Request,
  name: string,
  pattern: RegExp,
): string | undefined {
  const value = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + '='))
    ?.slice(name.length + 1);
  return value && pattern.test(value) ? value : undefined;
}

@Injectable()
export class AdvertisingService {
  private readonly logger = new Logger(AdvertisingService.name);

  constructor(private readonly prisma: PrismaService) {}

  enabled() {
    return vendors.some(destination);
  }

  async capture<T>(tx: Prisma.TransactionClient, produce: () => Promise<T>) {
    await tx.$executeRaw`SAVEPOINT advertising_capture`;
    try {
      const result = await produce();
      await tx.$executeRaw`RELEASE SAVEPOINT advertising_capture`;
      return result;
    } catch {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT advertising_capture`;
      await tx.$executeRaw`RELEASE SAVEPOINT advertising_capture`;
      this.logger.warn('Advertising capture failed');
      return undefined;
    }
  }

  config() {
    return {
      meta: destination('meta') ?? null,
      tiktok: destination('tiktok') ?? null,
    };
  }

  consentId(req: Request) {
    return cookie(req, CONSENT_COOKIE, /^[0-9a-f-]{36}$/);
  }

  async activeConsent(id?: string) {
    if (!id) return;
    const row = await this.prisma.advertisingConsent.findUnique({
      where: { id },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return;
    return row;
  }

  async setConsent(id: string | undefined, granted: boolean) {
    if (!granted) {
      if (id)
        await this.prisma.$transaction([
          this.prisma.advertisingConsent.updateMany({
            where: { id, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
          this.prisma.advertisingCheckout.deleteMany({
            where: { consentId: id },
          }),
          this.prisma.advertisingDelivery.updateMany({
            where: { consentId: id, finishedAt: null },
            data: {
              finishedAt: new Date(),
              result: 'suppressed',
              attribution: {},
            },
          }),
        ]);
      return null;
    }
    if (id && (await this.activeConsent(id))) return id;
    const consent = await this.prisma.advertisingConsent.create({
      data: {
        id: randomUUID(),
        expiresAt: new Date(Date.now() + CONSENT_SECONDS * 1000),
      },
    });
    return consent.id;
  }

  async context(req: Request): Promise<AdvertisingContext | undefined> {
    if (!vendors.some(destination)) return;
    const consentId = this.consentId(req);
    if (!consentId) return;
    const agent = req.get('user-agent')?.slice(0, 512);
    if (!agent || /bot\b|spider|crawler|headless|preview|curl\//i.test(agent))
      return;
    try {
      if (!(await this.activeConsent(consentId))) return;
    } catch {
      this.logger.warn('Advertising consent lookup failed');
      return;
    }
    // Nginx overwrites X-Real-IP for the API. Direct deployments omit the value.
    const forwarded =
      process.env.ADVERTISING_TRUST_NGINX === '1'
        ? req.get('x-real-ip')
        : undefined;
    return {
      consentId,
      agent,
      ip: forwarded && isIP(forwarded) ? forwarded : undefined,
      fbp: cookie(req, '_fbp', /^fb\.\d+\.\d{10,16}\.\d{1,32}$/),
      fbc:
        cookie(req, '_fbc', /^fb\.\d+\.\d{10,16}\.[\w.-]{1,256}$/) ??
        cookie(req, 'pb_ad_fbc', /^fb\.\d+\.\d{10,16}\.[\w.-]{1,256}$/),
      ttp: cookie(req, '_ttp', /^[\w.-]{1,256}$/),
      ttclid: cookie(req, 'pb_ad_ttclid', /^[\w.-]{1,256}$/),
    };
  }

  async saveCheckout(
    tx: Prisma.TransactionClient,
    checkoutId: string,
    context: AdvertisingContext,
  ) {
    await tx.advertisingCheckout.create({
      data: {
        checkoutId,
        consentId: context.consentId,
        attribution: JSON.parse(
          JSON.stringify(context),
        ) as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 7 * MAX_DELIVERY_AGE),
      },
    });
  }

  async checkoutContext(tx: Prisma.TransactionClient, checkoutId: string) {
    const row = await tx.advertisingCheckout.findUnique({
      where: { checkoutId },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return;
    const consent = await tx.advertisingConsent.findUnique({
      where: { id: row.consentId },
    });
    if (
      !consent ||
      consent.revokedAt ||
      consent.expiresAt.getTime() <= Date.now()
    )
      return;
    return row.attribution as AdvertisingContext;
  }

  async enqueue(
    tx: Prisma.TransactionClient,
    event: Conversion,
    context: AdvertisingContext,
  ) {
    const configured = vendors.filter((vendor) => {
      const config = destination(vendor);
      return config && conversionProperties(event, config, vendor);
    });
    if (configured.length === 0) return;
    const eventData = JSON.parse(
      JSON.stringify(event),
    ) as Prisma.InputJsonValue;
    const attribution = JSON.parse(
      JSON.stringify(context),
    ) as Prisma.InputJsonValue;
    await tx.advertisingDelivery.createMany({
      data: configured.map((vendor) => ({
        vendor,
        eventId: event.id,
        event: eventData,
        attribution,
        consentId: context.consentId,
      })),
      skipDuplicates: true,
    });
  }

  async purchaseReceipt(orderId: string, req: Request) {
    const context = await this.context(req);
    if (!context) return;
    try {
      const row = await this.prisma.advertisingDelivery.findFirst({
        where: {
          consentId: context.consentId,
          eventId: 'order_' + orderId,
          createdAt: { gte: new Date(Date.now() - MAX_DELIVERY_AGE) },
        },
        select: { event: true },
      });
      return row?.event as Conversion | undefined;
    } catch {
      this.logger.warn('Advertising purchase receipt lookup failed');
      return;
    }
  }

  async drain() {
    const now = new Date();
    const rows = await this.prisma.advertisingDelivery.findMany({
      where: { finishedAt: null, nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 20,
    });
    await Promise.all(rows.map((row) => this.deliver(row)));
  }

  async prune() {
    const cutoff = new Date(Date.now() - 2 * MAX_DELIVERY_AGE);
    await this.prisma.advertisingDelivery.deleteMany({
      where: { finishedAt: { lt: cutoff } },
    });
    await this.prisma.advertisingCheckout.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await this.prisma.advertisingConsent.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
  }

  private async deliver(
    row: Awaited<
      ReturnType<PrismaService['advertisingDelivery']['findMany']>
    >[number],
  ) {
    const attempts = row.attempts + 1;
    const claimed = await this.prisma.advertisingDelivery.updateMany({
      where: {
        id: row.id,
        attempts: row.attempts,
        finishedAt: null,
        nextAttemptAt: { lte: new Date() },
      },
      data: { attempts, nextAttemptAt: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count !== 1) return;

    const vendor = row.vendor as Vendor;
    const config = destination(vendor);
    const context = row.attribution as AdvertisingContext;
    const event = row.event as Conversion;
    let result = 'suppressed';
    if (
      config &&
      attempts <= MAX_ATTEMPTS &&
      Date.now() - row.createdAt.getTime() < MAX_DELIVERY_AGE &&
      (await this.activeConsent(row.consentId))
    ) {
      const payload = conversionPayload(
        event,
        vendor,
        config,
        context,
        row.createdAt,
      );
      if (payload) result = await this.send(vendor, payload);
    }

    const retry = result === 'retry' && attempts < MAX_ATTEMPTS;
    if (!retry && result === 'retry') result = 'retry_exhausted';
    await this.prisma.advertisingDelivery.updateMany({
      where: { id: row.id, attempts, finishedAt: null },
      data: retry
        ? {
            nextAttemptAt: new Date(
              Date.now() + Math.min(2 ** attempts * 15_000, 900_000),
            ),
          }
        : { finishedAt: new Date(), result, attribution: {} },
    });
    if (!retry && result !== 'accepted' && result !== 'suppressed') {
      this.logger.warn(
        `Advertising delivery ended: ${vendor} ${event.name} ${result}`,
      );
    }
  }

  private async send(vendor: Vendor, payload: object): Promise<string> {
    const meta = vendor === 'meta';
    const endpoint = meta
      ? `https://graph.facebook.com/${process.env.ADVERTISING_META_VERSION}/1629408292294202/events`
      : 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
    const token =
      process.env[`ADVERTISING_${vendor.toUpperCase()}_TOKEN`] || '';
    if (!token) return 'missing_token';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(meta
            ? { Authorization: `Bearer ${token}` }
            : { 'Access-Token': token }),
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(4_000),
      });
      if (response.status === 429 || response.status >= 500) return 'retry';
      const data = (await response.json()) as {
        events_received?: number;
        code?: number;
        error?: { is_transient?: boolean };
      };
      if (data.error?.is_transient) return 'retry';
      return response.ok &&
        (meta ? data.events_received === 1 : data.code === 0)
        ? 'accepted'
        : 'rejected';
    } catch {
      return 'retry';
    }
  }
}
