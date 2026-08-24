import { RealtrackClientService } from './realtrack-client.service';

describe('RealtrackClientService', () => {
  const envNames = [
    'REALTRACK_BRIDGE_API_URL',
    'REALTRACK_BRIDGE_EMAIL',
    'REALTRACK_BRIDGE_PASSWORD',
    'REALTRACK_BRIDGE_REQUEST_INTERVAL_MS',
    'REALTRACK_BRIDGE_MAX_RETRIES',
    'REALTRACK_BRIDGE_MAX_RETRY_DELAY_MS',
    'REALTRACK_BRIDGE_RETRY_BASE_DELAY_MS',
  ];
  const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );

  afterEach(() => {
    for (const name of envNames) {
      const value = originalEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    jest.restoreAllMocks();
  });

  it('retries a rate-limited write and honors a zero-second retry hint', async () => {
    process.env.REALTRACK_BRIDGE_API_URL = 'https://realtrack.test/api';
    process.env.REALTRACK_BRIDGE_EMAIL = 'bridge@example.test';
    process.env.REALTRACK_BRIDGE_PASSWORD = 'secret';
    process.env.REALTRACK_BRIDGE_REQUEST_INTERVAL_MS = '0';
    process.env.REALTRACK_BRIDGE_MAX_RETRIES = '1';
    process.env.REALTRACK_BRIDGE_MAX_RETRY_DELAY_MS = '250';
    process.env.REALTRACK_BRIDGE_RETRY_BASE_DELAY_MS = '100';

    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'slow down' }), {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'listing-1' }), { status: 201 }),
      );

    await expect(
      new RealtrackClientService().createListing({ title: 'Test' }),
    ).resolves.toEqual({
      id: 'listing-1',
      raw: { id: 'listing-1' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
