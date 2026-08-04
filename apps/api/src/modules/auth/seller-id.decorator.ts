import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthenticatedUser } from './auth.types';

/**
 * Reads `sellerId` from the query string or body and checks it against the
 * caller's JWT-granted seller memberships — use on any `merchant/*` route
 * alongside `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('SELLER')` so a
 * logged-in seller can't act on another seller's data by passing a different id.
 */
export const SellerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      query: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();
    const sellerId = (request.query?.sellerId ?? request.body?.sellerId) as
      string | undefined;
    if (!sellerId) {
      throw new ForbiddenException('sellerId is required');
    }
    if (!request.user?.sellerIds.includes(sellerId)) {
      throw new ForbiddenException(
        'You do not have access to this seller account',
      );
    }
    return sellerId;
  },
);
