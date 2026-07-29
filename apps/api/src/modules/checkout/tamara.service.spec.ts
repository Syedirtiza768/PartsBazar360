import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { TamaraService } from './tamara.service';

function sign(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(
    JSON.stringify({ typ: 'JWT', alg: 'HS256' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('TamaraService webhook authentication', () => {
  const previousToken = process.env.TAMARA_NOTIFICATION_TOKEN;
  const service = new TamaraService();

  beforeEach(() => {
    process.env.TAMARA_NOTIFICATION_TOKEN = 'notification-secret';
  });

  afterAll(() => {
    if (previousToken === undefined) {
      delete process.env.TAMARA_NOTIFICATION_TOKEN;
    } else {
      process.env.TAMARA_NOTIFICATION_TOKEN = previousToken;
    }
  });

  it('accepts a valid, active HS256 token', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign(
      { iss: 'Tamara', iat: now, exp: now + 60 },
      'notification-secret',
    );

    expect(() => service.verifyWebhookToken(token)).not.toThrow();
  });

  it('rejects a token signed with another secret', () => {
    const token = sign(
      { iss: 'Tamara', exp: Math.floor(Date.now() / 1000) + 60 },
      'wrong-secret',
    );

    expect(() => service.verifyWebhookToken(token)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', () => {
    const token = sign(
      { iss: 'Tamara', exp: Math.floor(Date.now() / 1000) - 1 },
      'notification-secret',
    );

    expect(() => service.verifyWebhookToken(token)).toThrow(
      UnauthorizedException,
    );
  });
});
