import {
  buildHolidayFilter,
  buildHolidaySort,
  publicVisibilityFilter,
  shouldExposeSamples,
  slugify,
} from './holidays.utils';

describe('slugify', () => {
  it('lowercases, strips diacritics and collapses separators', () => {
    expect(slugify('Istanbul: Two Continents & Bazaars!')).toBe('istanbul-two-continents-and-bazaars');
    expect(slugify('Türkiye  Escape')).toBe('turkiye-escape');
  });

  it('caps length without a trailing hyphen and returns empty for unusable input', () => {
    const slug = slugify(`${'a'.repeat(79)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugify('!!! ???')).toBe('');
  });
});

describe('sample visibility', () => {
  it('shows samples outside production', () => {
    expect(shouldExposeSamples('development', undefined)).toBe(true);
    expect(shouldExposeSamples('test', 'false')).toBe(true);
  });

  it('hides samples in production unless explicitly allowed', () => {
    expect(shouldExposeSamples('production', undefined)).toBe(false);
    expect(shouldExposeSamples('production', 'false')).toBe(false);
    expect(shouldExposeSamples('production', 'true')).toBe(true);
  });

  it('builds the matching public filter', () => {
    expect(publicVisibilityFilter(true)).toEqual({ published: true });
    expect(publicVisibilityFilter(false)).toEqual({ published: true, isSample: { $ne: true } });
  });
});

describe('buildHolidayFilter', () => {
  const base = { published: true };

  it('returns only the base filter for an empty query', () => {
    expect(buildHolidayFilter({}, base)).toEqual(base);
  });

  it('maps every filter field', () => {
    expect(
      buildHolidayFilter(
        {
          q: ' beach ',
          destination: 'Dubai',
          country: 'United Arab Emirates',
          theme: 'Family',
          collection: 'dubai-stopover',
          minNights: 2,
          maxNights: 4,
        },
        base,
      ),
    ).toEqual({
      published: true,
      $text: { $search: 'beach' },
      destinations: 'Dubai',
      country: 'United Arab Emirates',
      themes: 'Family',
      collections: 'dubai-stopover',
      durationNights: { $gte: 2, $lte: 4 },
    });
  });

  it('supports a zero minimum and a single bound', () => {
    expect(buildHolidayFilter({ minNights: 0 }, base).durationNights).toEqual({ $gte: 0 });
    expect(buildHolidayFilter({ maxNights: 3 }, base).durationNights).toEqual({ $lte: 3 });
  });

  it('ignores a blank text query', () => {
    expect(buildHolidayFilter({ q: '   ' }, base)).toEqual(base);
  });
});

describe('buildHolidaySort', () => {
  it('defaults to popularity', () => {
    expect(buildHolidaySort().sort).toEqual({ popularity: -1, createdAt: -1, _id: 1 });
  });

  it('computes a sortable price for price sorts and puts unpriced packages last', () => {
    const asc = buildHolidaySort('price_asc');
    expect(Object.keys(asc.sort)[0]).toBe('_sortPrice');
    expect(asc.sort._sortPrice).toBe(1);
    expect(asc.addFields).toBeDefined();
    const desc = buildHolidaySort('price_desc');
    expect(desc.sort._sortPrice).toBe(-1);
    expect(JSON.stringify(desc.addFields)).toContain('-1');
  });

  it('maps nights and newest sorts', () => {
    expect(buildHolidaySort('nights_asc').sort.durationNights).toBe(1);
    expect(buildHolidaySort('nights_desc').sort.durationNights).toBe(-1);
    expect(buildHolidaySort('newest').sort.createdAt).toBe(-1);
  });
});
