import {
  normalizeConfigField,
  resolveVehicleConfiguration,
  VehicleConfigStore,
} from './vehicle-config-identity.util';

function makeStore(overrides?: {
  findFirst?: jest.Mock;
  create?: jest.Mock;
}): { store: VehicleConfigStore; findFirst: jest.Mock; create: jest.Mock } {
  const findFirst = overrides?.findFirst ?? jest.fn().mockResolvedValue(null);
  const create =
    overrides?.create ??
    jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new-1', ...data }));
  return { store: { vehicleConfiguration: { findFirst, create } }, findFirst, create };
}

describe('normalizeConfigField', () => {
  it('maps empty, whitespace, null and undefined to null', () => {
    expect(normalizeConfigField('')).toBeNull();
    expect(normalizeConfigField('   ')).toBeNull();
    expect(normalizeConfigField(null)).toBeNull();
    expect(normalizeConfigField(undefined)).toBeNull();
  });

  it('trims but preserves the original casing', () => {
    expect(normalizeConfigField('  Base ')).toBe('Base');
  });
});

describe('resolveVehicleConfiguration', () => {
  it('returns the existing configuration without creating', async () => {
    const existing = { id: 'cfg-1', generationId: 'gen-1' };
    const { store, findFirst, create } = makeStore({
      findFirst: jest.fn().mockResolvedValue(existing),
    });

    const result = await resolveVehicleConfiguration(store, {
      generationId: 'gen-1',
      market: 'GLOBAL',
    });

    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
    // Absent display fields must be matched as NULL, not omitted — a row
    // with trim='SE' is NOT the same vehicle as an all-NULL row.
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        generationId: 'gen-1',
        trim: null,
        engine: null,
        transmission: null,
        drivetrain: null,
        fuel: null,
      },
    });
  });

  it('matches present display fields case-insensitively', async () => {
    const { store, findFirst } = makeStore({
      findFirst: jest.fn().mockResolvedValue({ id: 'cfg-9' }),
    });

    await resolveVehicleConfiguration(store, {
      generationId: 'gen-1',
      trim: 'se',
      engine: '1.8L',
      market: 'US',
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        generationId: 'gen-1',
        trim: { equals: 'se', mode: 'insensitive' },
        engine: { equals: '1.8L', mode: 'insensitive' },
        transmission: null,
        drivetrain: null,
        fuel: null,
      },
    });
  });

  it('creates with normalized display fields and provenance market when absent', async () => {
    const { store, create } = makeStore();

    const result = await resolveVehicleConfiguration(store, {
      generationId: 'gen-1',
      trim: '  ',
      engine: '2.0L',
      market: 'GLOBAL',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        generationId: 'gen-1',
        market: 'GLOBAL',
        trim: null,
        engine: '2.0L',
        transmission: null,
        drivetrain: null,
        fuel: null,
      },
    });
    expect(result).toEqual(
      expect.objectContaining({ id: 'new-1', generationId: 'gen-1' }),
    );
  });

  it('defaults market to null on create when not provided', async () => {
    const { store, create } = makeStore();

    await resolveVehicleConfiguration(store, { generationId: 'gen-1' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ market: null }),
    });
  });

  it('returns the winner row when a concurrent create loses the unique-index race (P2002)', async () => {
    const winner = { id: 'cfg-winner', generationId: 'gen-1' };
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // initial lookup: absent
      .mockResolvedValueOnce(winner); // post-P2002 lookup: winner visible
    const create = jest
      .fn()
      .mockRejectedValue({ code: 'P2002', meta: { target: ['generationId'] } });
    const { store } = makeStore({ findFirst, create });

    const result = await resolveVehicleConfiguration(store, {
      generationId: 'gen-1',
      market: 'GLOBAL',
    });

    expect(result).toBe(winner);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('rethrows P2002 when no winner row can be found', async () => {
    const error = { code: 'P2002' };
    const { store } = makeStore({
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(error),
    });

    await expect(
      resolveVehicleConfiguration(store, { generationId: 'gen-1' }),
    ).rejects.toBe(error);
  });

  it('rethrows non-P2002 create errors unchanged', async () => {
    const error = new Error('connection reset');
    const { store, findFirst } = makeStore({
      create: jest.fn().mockRejectedValue(error),
    });

    await expect(
      resolveVehicleConfiguration(store, { generationId: 'gen-1' }),
    ).rejects.toBe(error);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
