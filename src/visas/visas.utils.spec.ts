import {
  buildSearchRegex,
  buildVisaFilter,
  buildVisaSort,
  ENQUIRY_REFERENCE_PATTERN,
  generateEnquiryReference,
  isNotPastDate,
  publicVisibilityFilter,
  shouldExposeSamples,
} from './visas.utils';

describe('sample visibility', () => {
  it('shows samples outside production', () => {
    expect(shouldExposeSamples('development', undefined)).toBe(true);
    expect(shouldExposeSamples('test', 'false')).toBe(true);
  });

  it('hides samples in production unless VISAS_ALLOW_SAMPLES=true', () => {
    expect(shouldExposeSamples('production', undefined)).toBe(false);
    expect(shouldExposeSamples('production', 'false')).toBe(false);
    expect(shouldExposeSamples('production', 'true')).toBe(true);
  });

  it('builds the matching public filter', () => {
    expect(publicVisibilityFilter(true)).toEqual({ published: true });
    expect(publicVisibilityFilter(false)).toEqual({ published: true, isSample: { $ne: true } });
  });
});

describe('buildSearchRegex', () => {
  it('matches case-insensitively and ignores diacritics', () => {
    expect(buildSearchRegex('turk').test('Türkiye e-Visa')).toBe(true);
    expect(buildSearchRegex('TÜRK').test('turkiye')).toBe(true);
    expect(buildSearchRegex('arab').test('United Arab Emirates')).toBe(true);
    expect(buildSearchRegex('arab').test('Japan')).toBe(false);
  });

  it('escapes regex syntax from user input', () => {
    expect(buildSearchRegex('.*').test('Japan')).toBe(false);
    expect(buildSearchRegex('(a').test('Japan')).toBe(false);
    expect(() => buildSearchRegex('[')).not.toThrow();
  });
});

describe('buildVisaFilter', () => {
  const base = { published: true };

  it('returns only the base filter for an empty query', () => {
    expect(buildVisaFilter({}, base)).toEqual(base);
    expect(buildVisaFilter({ q: '   ' }, base)).toEqual(base);
  });

  it('maps q to a country/title match and kind/country to equality', () => {
    const filter = buildVisaFilter({ q: ' turk ', kind: 'embassy', country: 'Japan' }, base);
    expect(filter).toMatchObject({ published: true, kind: 'embassy', country: 'Japan' });
    const or = filter.$or as { country?: RegExp; title?: RegExp }[];
    expect(or).toHaveLength(2);
    expect(or[0].country).toBeInstanceOf(RegExp);
    expect(or[1].title).toBeInstanceOf(RegExp);
  });
});

describe('buildVisaSort', () => {
  it('defaults to popularity', () => {
    expect(buildVisaSort().sort).toEqual({ popularity: -1, country: 1, _id: 1 });
  });

  it('computes a sortable price and puts unpriced visas last in both directions', () => {
    const asc = buildVisaSort('price_asc');
    expect(Object.keys(asc.sort)[0]).toBe('_sortPrice');
    expect(asc.sort._sortPrice).toBe(1);
    expect(JSON.stringify(asc.addFields)).toContain(String(Number.MAX_SAFE_INTEGER));
    const desc = buildVisaSort('price_desc');
    expect(desc.sort._sortPrice).toBe(-1);
    expect(JSON.stringify(desc.addFields)).toContain('-1');
  });

  it('sorts by name with a locale-aware collation', () => {
    const name = buildVisaSort('name');
    expect(name.sort).toEqual({ country: 1, title: 1, _id: 1 });
    expect(name.collation).toEqual({ locale: 'en', strength: 1 });
  });
});

describe('generateEnquiryReference', () => {
  it('has the VQ- prefix and 8 base32 characters', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateEnquiryReference()).toMatch(ENQUIRY_REFERENCE_PATTERN);
    }
  });

  it('does not repeat across a large sample', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => generateEnquiryReference()));
    expect(seen.size).toBe(5000);
  });
});

describe('isNotPastDate', () => {
  const now = new Date('2026-10-04T15:00:00Z');

  it('accepts today and the future, rejects the past and garbage', () => {
    expect(isNotPastDate('2026-10-04', now)).toBe(true);
    expect(isNotPastDate('2027-01-15', now)).toBe(true);
    expect(isNotPastDate('2026-10-03', now)).toBe(false);
    expect(isNotPastDate('not-a-date', now)).toBe(false);
  });
});
