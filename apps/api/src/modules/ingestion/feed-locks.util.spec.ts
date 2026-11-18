import {
  activeFeedLocks,
  FEED_LOCKABLE_FIELDS,
  preserveFeedLockedFields,
} from './feed-locks.util';

const repairedPart = {
  title: 'FEBI BILSTEIN Tie Rod End with lock nut 102410 - New Aftermarket',
  normalizedTitle:
    'FEBI BILSTEIN Tie Rod End with lock nut 102410 - New Aftermarket',
  brand: 'FEBI BILSTEIN',
  category: 'Tie Rods',
  description:
    'FEBI BILSTEIN Tie Rod End with lock nut 102410. Part number: 102410.',
  imageUrls: ['https://example.test/1.jpg'],
  feedLockedFields: [...FEED_LOCKABLE_FIELDS] as string[],
};

const feedUpdate = {
  title: 'FEBI | Tie Rod End 102410 | OE 204 330 19 03 | Fits Mercedes-Benz',
  brand: 'Genuine OEM',
  category: 'General Automotive Parts',
  description: '<style>:root{--primary-black:#1a1a1a}</style>…',
  imageUrls: ['https://example.test/2.jpg'],
  partType: 'AFTERMARKET',
};

describe('preserveFeedLockedFields', () => {
  it('keeps the stored text when spread after the feed values', () => {
    const data = { ...feedUpdate, ...preserveFeedLockedFields(repairedPart) };
    expect(data).toEqual({
      title: repairedPart.title,
      normalizedTitle: repairedPart.normalizedTitle,
      brand: 'FEBI BILSTEIN',
      category: 'Tie Rods',
      description: repairedPart.description,
      imageUrls: feedUpdate.imageUrls,
      partType: 'AFTERMARKET',
    });
  });

  it('adds nothing when the part has no locks', () => {
    for (const feedLockedFields of [[], null, undefined]) {
      expect(
        preserveFeedLockedFields({ ...repairedPart, feedLockedFields }),
      ).toEqual({});
    }
  });

  it('locks only the listed fields', () => {
    const data = {
      ...feedUpdate,
      ...preserveFeedLockedFields({
        ...repairedPart,
        feedLockedFields: ['brand', 'description'],
      }),
    };
    expect(data.title).toBe(feedUpdate.title);
    expect(data.category).toBe(feedUpdate.category);
    expect(data.brand).toBe('FEBI BILSTEIN');
    expect(data.description).toBe(repairedPart.description);
    expect(data).not.toHaveProperty('normalizedTitle');
  });

  it('keeps a stored null, so a cleared label brand stays cleared', () => {
    const data = {
      ...feedUpdate,
      ...preserveFeedLockedFields({
        ...repairedPart,
        brand: null,
        feedLockedFields: ['brand'],
      }),
    };
    expect(data.brand).toBeNull();
  });

  it('skips columns the caller did not select', () => {
    const selected: Partial<typeof repairedPart> = { ...repairedPart };
    delete selected.normalizedTitle;
    expect(preserveFeedLockedFields(selected)).not.toHaveProperty(
      'normalizedTitle',
    );
  });

  it('ignores names that are not lockable, so a typo cannot freeze other columns', () => {
    expect(
      preserveFeedLockedFields({
        ...repairedPart,
        feedLockedFields: ['imageUrls', 'partType', 'Title'],
      }),
    ).toEqual({});
  });
});

describe('activeFeedLocks', () => {
  it('de-duplicates and filters to lockable names', () => {
    expect(activeFeedLocks(['brand', 'brand', 'weight', 'title'])).toEqual([
      'brand',
      'title',
    ]);
  });
});
