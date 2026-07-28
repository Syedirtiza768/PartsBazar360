import { flattenItemSpecifics } from './item-specifics-generator';
import {
  buildLocationDiagramPrompt,
  isManualReviewResponse,
} from './location-diagram-prompt';
import {
  buildListingDataFromPart,
  resolveLocationDiagramSource,
} from './location-diagram';

describe('flattenItemSpecifics', () => {
  it('maps listing-pipeline fields to PDP camelCase keys', () => {
    const flat = flattenItemSpecifics(
      [
        { field: 'Position', value: 'Front' },
        { field: 'Material', value: 'Steel' },
        { field: 'Part Type', value: 'Gear Selector' },
        { field: 'Placement on Vehicle', value: 'Center console' },
      ],
      { vehicleSystem: 'Interior', partType: 'Ignored when present' },
    );

    expect(flat).toMatchObject({
      position: 'Front',
      material: 'Steel',
      partType: 'Gear Selector',
      placementOnVehicle: 'Center console',
      vehicleSystem: 'Interior',
    });
  });

  it('skips null values and prefers publishable duplicates', () => {
    const flat = flattenItemSpecifics([
      { field: 'Color', value: 'Black', autoPublish: true },
      { field: 'Color', value: 'Maybe grey', autoPublish: false },
      { field: 'Warranty', value: null },
    ]);
    expect(flat.color).toBe('Black');
    expect(flat.warranty).toBeUndefined();
  });
});

describe('location diagram prompts', () => {
  const listing = buildListingDataFromPart({
    title: '2013 BMW 520i Gear Selector Shift Assembly Used OEM 61317950394',
    partName: 'Automatic Transmission Gear Selector Assembly',
    oemPartNumber: '61317950394',
    calloutNumber: '7',
    year: 2013,
    make: 'BMW',
    model: '520i',
    trim: 'F10',
    engine: '2.0L gasoline',
    partPosition: 'Front center console',
    quantityIncluded: 1,
  });

  it('fills OEM callout placeholders', () => {
    const { prompt } = buildLocationDiagramPrompt('oem_callout', listing);
    expect(prompt).toContain('TARGET_CALLOUT_NUMBER');
    expect(prompt).toContain('61317950394');
    expect(prompt).toContain('Diagram callout number: 7');
    expect(prompt).toContain('HIGHLIGHTED COMPONENT ONLY');
    expect(prompt).toContain('ITEM 7');
  });

  it('uses quantity statement when qty > 1', () => {
    const { prompt } = buildLocationDiagramPrompt('oem_callout', {
      ...listing,
      quantityIncluded: 2,
    });
    expect(prompt).toContain('HIGHLIGHTED COMPONENTS ONLY — QUANTITY: 2');
  });

  it('uses the non-OEM location guide prompt without inventing diagrams', () => {
    const { prompt, negativePrompt } = buildLocationDiagramPrompt(
      'location_guide',
      listing,
    );
    expect(prompt).toContain('ILLUSTRATIVE LOCATION GUIDE — NOT AN OEM DIAGRAM');
    expect(prompt).not.toContain('Transform the supplied OEM exploded');
    expect(negativePrompt).toContain('Do not fabricate an OEM diagram');
  });

  it('detects manual-review responses', () => {
    expect(
      isManualReviewResponse(
        'MANUAL REVIEW REQUIRED — TARGET COMPONENT NOT VERIFIED',
      ),
    ).toBe(true);
    expect(isManualReviewResponse('here is your png')).toBe(false);
  });
});

describe('resolveLocationDiagramSource', () => {
  it('prefers OEM diagram + callout when both exist', () => {
    const source = resolveLocationDiagramSource({
      media: [
        { url: 'https://cdn.example/photo.jpg', mediaType: 'IMAGE' },
        { url: 'https://cdn.example/exploded.png', mediaType: 'DIAGRAM' },
      ],
      calloutNumber: '7',
    });
    expect(source).toEqual({
      mode: 'oem_callout',
      referenceImageUrl: 'https://cdn.example/exploded.png',
    });
  });

  it('falls back to seller photo when no OEM diagram/callout', () => {
    const source = resolveLocationDiagramSource({
      media: [{ url: 'https://cdn.example/photo.jpg', mediaType: 'IMAGE' }],
      calloutNumber: null,
    });
    expect(source).toEqual({
      mode: 'location_guide',
      referenceImageUrl: 'https://cdn.example/photo.jpg',
    });
  });

  it('returns null when there is no usable image', () => {
    expect(
      resolveLocationDiagramSource({ media: [], imageUrls: [], calloutNumber: '1' }),
    ).toBeNull();
  });
});
