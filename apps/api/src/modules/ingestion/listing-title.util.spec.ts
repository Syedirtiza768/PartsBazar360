/**
 * Unit tests for English title extraction.
 */
import {
  extractEnglishTitle,
  looksLikeEnglishTitle,
} from './listing-title.util';

describe('listing-title.util', () => {
  it('prefers titleEn over title', () => {
    expect(
      extractEnglishTitle({ title: 'Titulo ES', titleEn: 'English Title' }),
    ).toBe('English Title');
  });

  it('falls back to title', () => {
    expect(extractEnglishTitle({ title: 'Used Steering Column' })).toBe(
      'Used Steering Column',
    );
  });

  it('detects English titles', () => {
    expect(
      looksLikeEnglishTitle('Used Steering Column for Porsche Cayenne 2008'),
    ).toBe(true);
    expect(looksLikeEnglishTitle('エンジン トヨタ')).toBe(false);
  });

  it('rejects Italian, French, German and Spanish titles', () => {
    expect(
      looksLikeEnglishTitle('Centralina clima BMW 330e 2016-2020 16046610'),
    ).toBe(false);
    expect(looksLikeEnglishTitle('Cache volant BMW 335i 2009 occasion')).toBe(
      false,
    );
    expect(
      looksLikeEnglishTitle('Braccio Comando Sospensioni Inferiore VW Jetta'),
    ).toBe(false);
    expect(looksLikeEnglishTitle('Stoßstange vorne Audi A4 gebraucht')).toBe(
      false,
    );
    expect(looksLikeEnglishTitle('Amortiguador delantero Seat Leon')).toBe(
      false,
    );
  });

  it('matches accented terms that ASCII word boundaries would miss', () => {
    expect(looksLikeEnglishTitle('Tür hinten links Golf V')).toBe(false);
    expect(looksLikeEnglishTitle('Ölpumpe BMW E46')).toBe(false);
  });

  it('rejects German compound nouns that whole-word boundaries miss', () => {
    // Glued stems — the regression reported on bentley search
    expect(looksLikeEnglishTitle('Bentley Aschenbecher 3W5857321C')).toBe(false);
    expect(looksLikeEnglishTitle('Bentley Bremsleitung 4W0614740B')).toBe(false);
    expect(looksLikeEnglishTitle('Bentley Einstiegsleiste 3W4863382M')).toBe(
      false,
    );
    expect(looksLikeEnglishTitle('Bentley Kabelbinder 893971850C')).toBe(false);
    expect(looksLikeEnglishTitle('Bentley Halterung 3W8951287B')).toBe(false);
    expect(looksLikeEnglishTitle('Bentley Seitenscheibe 4W0845215')).toBe(false);
    expect(looksLikeEnglishTitle('Bentley Radhaus 4W0810075')).toBe(false);
    expect(looksLikeEnglishTitle('Bentley Innenspiegel 4W2857409A')).toBe(false);
    expect(looksLikeEnglishTitle('Bentley Federbein A2126280124')).toBe(false);
    expect(
      looksLikeEnglishTitle('Bentley Klemmplatte 4W0885372'),
    ).toBe(false);
    expect(looksLikeEnglishTitle('Bentley Spannfeder 4H0886215')).toBe(false);
    expect(
      looksLikeEnglishTitle('Bentley Kugellager 0B6311235'),
    ).toBe(false);
    // ASCII-transliterated umlaut compounds (no actual ä/ö/ü/ß char)
    expect(looksLikeEnglishTitle('Stossstange vorne Audi A4')).toBe(false);
    expect(looksLikeEnglishTitle('Getriebe BMW E46 gebraucht')).toBe(false);
  });

  it('keeps English titles that contain lookalike words', () => {
    expect(looksLikeEnglishTitle('Flexible Brake Hose Front Toyota')).toBe(
      true,
    );
    expect(
      looksLikeEnglishTitle('2018 Ford F-150 Air Filter Housing Used OEM'),
    ).toBe(true);
    expect(looksLikeEnglishTitle('Rear Suspension Control Arm Bushing')).toBe(
      true,
    );
  });

  it('keeps English auto terms that overlap German stems', () => {
    // Substring stems were chosen to avoid these English false positives
    expect(looksLikeEnglishTitle('Radiator Cooling Fan Assembly')).toBe(true);
    expect(looksLikeEnglishTitle('Radio Navigation Screen Display')).toBe(true);
    expect(looksLikeEnglishTitle('Tachometer Cluster Instrument Panel')).toBe(
      true,
    );
    expect(looksLikeEnglishTitle('Hybrid Battery Pack Module')).toBe(true);
    expect(looksLikeEnglishTitle('Engine Thermostat Housing OEM')).toBe(true);
    expect(looksLikeEnglishTitle('Blend Door Actuator HVAC')).toBe(true);
    expect(looksLikeEnglishTitle('Stabilizer Bar Link Bushing')).toBe(true);
    expect(looksLikeEnglishTitle('EGR Valve Check')).toBe(true);
    expect(looksLikeEnglishTitle('Rear Bumper Reinforcement OEM')).toBe(true);
    expect(looksLikeEnglishTitle('Bentley Bolster 4W0881813')).toBe(true);
    expect(looksLikeEnglishTitle('Bentley nozzle 1J0971903')).toBe(true);
    expect(looksLikeEnglishTitle('Bentley Grommet 3W0971871A')).toBe(true);
  });

  it('rejects blank titles', () => {
    expect(looksLikeEnglishTitle('')).toBe(false);
  });
});
