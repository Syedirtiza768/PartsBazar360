import { RealtrackFxService } from './realtrack-fx.service';

describe('RealtrackFxService', () => {
  const originalRates = process.env.REALTRACK_BRIDGE_FX_RATES;
  const originalUrl = process.env.REALTRACK_BRIDGE_FX_API_URL;

  afterEach(() => {
    if (originalRates === undefined) {
      delete process.env.REALTRACK_BRIDGE_FX_RATES;
    } else {
      process.env.REALTRACK_BRIDGE_FX_RATES = originalRates;
    }
    if (originalUrl === undefined) {
      delete process.env.REALTRACK_BRIDGE_FX_API_URL;
    } else {
      process.env.REALTRACK_BRIDGE_FX_API_URL = originalUrl;
    }
    jest.restoreAllMocks();
  });

  it('keeps USD costs unchanged', async () => {
    const service = new RealtrackFxService();

    await expect(service.toUsd(12.5, 'USD')).resolves.toEqual({
      amountUsd: 12.5,
      rateToUsd: 1,
    });
  });

  it('uses a configured direct source-to-USD rate', async () => {
    process.env.REALTRACK_BRIDGE_FX_RATES = JSON.stringify({ AED: 0.272294 });
    const service = new RealtrackFxService();

    await expect(service.toUsd(100, 'AED')).resolves.toEqual({
      amountUsd: 27.2294,
      rateToUsd: 0.272294,
    });
  });

  it('inverts the provider USD-to-source rate', async () => {
    delete process.env.REALTRACK_BRIDGE_FX_RATES;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: 'success',
          base_code: 'USD',
          rates: { EUR: 0.92 },
        }),
    } as Response);
    const service = new RealtrackFxService();

    await expect(service.toUsd(10, 'EUR')).resolves.toEqual({
      amountUsd: 10.869565,
      rateToUsd: 1 / 0.92,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
