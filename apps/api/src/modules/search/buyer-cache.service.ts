import { Injectable, Logger } from '@nestjs/common';

/**
 * Asks the buyer Next.js app to drop ISR / Data Cache entries for a part so
 * PDPs refresh sooner than the revalidate TTL after merchant edits.
 * Failures are logged and swallowed — cache expiry remains the safety net.
 */
@Injectable()
export class BuyerCacheService {
  private readonly logger = new Logger(BuyerCacheService.name);

  async revalidatePart(partId: string | null | undefined): Promise<void> {
    if (!partId) return;
    const secret = process.env.REVALIDATE_SECRET;
    const base =
      process.env.BUYER_INTERNAL_URL ||
      process.env.BUYER_APP_URL ||
      'http://buyer-marketplace:3000/buyer';
    if (!secret) {
      this.logger.debug('REVALIDATE_SECRET unset — skipping on-demand revalidation');
      return;
    }

    const url = `${base.replace(/\/$/, '')}/api/revalidate/`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': secret,
        },
        body: JSON.stringify({ tag: `part:${partId}`, partId }),
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) {
        this.logger.warn(`Revalidate failed for ${partId}: HTTP ${res.status}`);
      }
    } catch (err: any) {
      this.logger.warn(`Revalidate errored for ${partId}: ${err?.message || err}`);
    }
  }
}
