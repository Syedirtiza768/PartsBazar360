import { estimateWeight } from './weight-estimator';
import {
  getPartClassProfile,
  resolvePartClassKey,
} from '../checkout/part-class-weights';

/**
 * The estimator's job is not to call a model — it is to refuse to trust one.
 * These tests pin the validation gates, since a hallucinated weight becomes a
 * wrong shipping price charged to a real buyer.
 */
describe('estimateWeight', () => {
  const partClassKey = resolvePartClassKey({ title: 'Front Brake Pad Set' });
  const profile = getPartClassProfile(partClassKey);

  const input = {
    title: 'Front Brake Pad Set for Toyota Corolla',
    brand: 'Febest',
    category: 'Brakes',
    partClassKey,
  };

  /** Returns a fake OpenRouter client that replies with the given payloads. */
  function clientReturning(...payloads: Array<Record<string, unknown> | Error>) {
    const call = jest.fn();
    for (const payload of payloads) {
      if (payload instanceof Error) {
        call.mockRejectedValueOnce(payload);
      } else {
        call.mockResolvedValueOnce({
          content: JSON.stringify(payload),
          usage: { estimatedCostUsd: 0.0002 },
          raw: {},
        });
      }
    }
    return { client: { call } as any, call };
  }

  const plausible = {
    weightKg: profile.medianWeightKg,
    lengthCm: profile.typicalDimsCm.l,
    widthCm: profile.typicalDimsCm.w,
    heightCm: profile.typicalDimsCm.h,
    confidence: 0.9,
    reasoning: 'Typical pad set with carton.',
  };

  it('accepts a plausible, confident estimate on the first attempt', async () => {
    const { client, call } = clientReturning(plausible);

    const result = await estimateWeight(client, input);

    expect(call).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.weightKg).toBeCloseTo(profile.medianWeightKg);
    expect(result!.clamped).toBe(false);
    expect(result!.confidence).toBe(0.9);
    expect(result!.dimensionsCm).toEqual({
      lengthCm: profile.typicalDimsCm.l,
      widthCm: profile.typicalDimsCm.w,
      heightCm: profile.typicalDimsCm.h,
    });
    expect(result!.costUsd).toBeGreaterThan(0);
  });

  it('clamps a modest overshoot into the class envelope', async () => {
    const overshoot = profile.maxWeightKg * 1.5;
    const { client } = clientReturning({ ...plausible, weightKg: overshoot });

    const result = await estimateWeight(client, input);

    expect(result!.weightKg).toBeCloseTo(profile.maxWeightKg);
    expect(result!.clamped).toBe(true);
  });

  it('rejects an answer that is off by an order of magnitude', async () => {
    // Both attempts return nonsense, so the caller should fall back to the class
    // default rather than quote a hallucinated weight.
    const absurd = { ...plausible, weightKg: profile.maxWeightKg * 500 };
    const { client, call } = clientReturning(absurd, absurd);

    const result = await estimateWeight(client, input);

    expect(call).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });

  it('escalates to the stronger model when confidence is low', async () => {
    const { client, call } = clientReturning(
      { ...plausible, confidence: 0.3 },
      { ...plausible, confidence: 0.85 },
    );

    const result = await estimateWeight(client, input);

    expect(call).toHaveBeenCalledTimes(2);
    expect(result!.confidence).toBe(0.85);
    // Cost accumulates across both attempts.
    expect(result!.costUsd).toBeCloseTo(0.0004);
  });

  it('discards an escalated answer that is still too uncertain', async () => {
    const shaky = { ...plausible, confidence: 0.2 };
    const { client } = clientReturning(shaky, shaky);

    expect(await estimateWeight(client, input)).toBeNull();
  });

  it('keeps the weight but drops dimensions that look like a unit error', async () => {
    const { client } = clientReturning({
      ...plausible,
      lengthCm: 4000,
      widthCm: 3000,
      heightCm: 2000,
    });

    const result = await estimateWeight(client, input);

    expect(result).not.toBeNull();
    expect(result!.dimensionsCm).toBeNull();
    expect(result!.weightKg).toBeCloseTo(profile.medianWeightKg);
  });

  it('returns null when the model emits unparseable output', async () => {
    const call = jest
      .fn()
      .mockResolvedValue({ content: 'not json at all', usage: {}, raw: {} });

    expect(await estimateWeight({ call } as any, input)).toBeNull();
  });

  it('returns null when every attempt throws', async () => {
    const { client, call } = clientReturning(
      new Error('upstream 500'),
      new Error('upstream 500'),
    );

    expect(await estimateWeight(client, input)).toBeNull();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('requests structured JSON output', async () => {
    const { client, call } = clientReturning(plausible);

    await estimateWeight(client, input);

    expect(call.mock.calls[0][0].responseFormat.type).toBe('json_schema');
    expect(call.mock.calls[0][0].temperature).toBe(0);
  });
});
