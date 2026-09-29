import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { RealtrackPushGuard } from './realtrack-publish.guard';

function contextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('RealtrackPushGuard', () => {
  const original = process.env.REALTRACK_PUSH_API_KEY;
  const guard = new RealtrackPushGuard();

  afterEach(() => {
    if (original === undefined) delete process.env.REALTRACK_PUSH_API_KEY;
    else process.env.REALTRACK_PUSH_API_KEY = original;
  });

  it('is disabled (503), not open, when no key is configured', () => {
    delete process.env.REALTRACK_PUSH_API_KEY;
    expect(() =>
      guard.canActivate(contextWith({ authorization: 'Bearer anything' })),
    ).toThrow(ServiceUnavailableException);
  });

  it('accepts a matching bearer token', () => {
    process.env.REALTRACK_PUSH_API_KEY = 'secret-key';
    expect(
      guard.canActivate(contextWith({ authorization: 'Bearer secret-key' })),
    ).toBe(true);
  });

  it('accepts a matching x-api-key header', () => {
    process.env.REALTRACK_PUSH_API_KEY = 'secret-key';
    expect(guard.canActivate(contextWith({ 'x-api-key': 'secret-key' }))).toBe(
      true,
    );
  });

  it.each([
    ['wrong key', { authorization: 'Bearer nope' }],
    ['wrong length', { authorization: 'Bearer secret-key-and-more' }],
    ['missing header', {}],
    ['non-bearer scheme', { authorization: 'Basic secret-key' }],
  ])('rejects %s', (_label, headers) => {
    process.env.REALTRACK_PUSH_API_KEY = 'secret-key';
    expect(() => guard.canActivate(contextWith(headers))).toThrow(
      UnauthorizedException,
    );
  });
});
