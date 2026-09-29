import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Machine-to-machine guard for RealTrack → PartsBazar360 publishing.
 *
 * A single shared secret (`REALTRACK_PUSH_API_KEY`) sent as
 * `Authorization: Bearer <key>` (or `x-api-key`). The key only proves the
 * caller is RealTrack; what it may write is bounded separately — the service
 * refuses any `storeId` that has no PartsBazar seller mapped to it.
 *
 * With the env var unset the feature is off (503), never open.
 */
@Injectable()
export class RealtrackPushGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.REALTRACK_PUSH_API_KEY?.trim();
    if (!expected) {
      throw new ServiceUnavailableException(
        'RealTrack publishing is not enabled on this server',
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const provided = this.extractKey(request.headers);
    if (!provided || !this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid RealTrack API key');
    }
    return true;
  }

  private extractKey(
    headers: Record<string, string | string[] | undefined>,
  ): string | null {
    const authorization = headers['authorization'];
    const bearer = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    const match = bearer?.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
    const apiKey = headers['x-api-key'];
    const value = Array.isArray(apiKey) ? apiKey[0] : apiKey;
    return value?.trim() || null;
  }

  /** Constant-time compare that does not leak the key length via early exit. */
  private safeEqual(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      // Still burn a comparison so timing does not distinguish length misses.
      timingSafeEqual(b, b);
      return false;
    }
    return timingSafeEqual(a, b);
  }
}
