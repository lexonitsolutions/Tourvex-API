import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { ListPartnersDto } from './dto/list-partners.dto';
import { buildPartnerFilter, shouldExposeSamples } from './partners.utils';

const check = (cls: new () => object, raw: object) =>
  validate(plainToInstance(cls, raw), { whitelist: true, forbidNonWhitelisted: true });
const base = { name: 'Skyline Observatory', category: 'Observation deck' };

describe('partner visibility', () => {
  it('hides samples in production unless PARTNERS_ALLOW_SAMPLES=true', () => {
    expect(shouldExposeSamples('production', undefined)).toBe(false);
    expect(shouldExposeSamples('production', 'true')).toBe(true);
    expect(shouldExposeSamples('development', undefined)).toBe(true);
  });

  it('builds the filter', () => {
    expect(buildPartnerFilter(undefined, true)).toEqual({ published: true });
    expect(buildPartnerFilter('home', false)).toEqual({
      published: true,
      isSample: { $ne: true },
      placements: 'home',
    });
  });
});

describe('CreatePartnerDto', () => {
  it('accepts a valid partner and safe logo/href', async () => {
    expect(await check(CreatePartnerDto, base)).toHaveLength(0);
    expect(
      await check(CreatePartnerDto, {
        ...base,
        logo: '/images/partners/x.svg',
        href: 'https://example.com',
        placements: ['home'],
        order: 999,
        published: false,
      }),
    ).toHaveLength(0);
  });

  it.each([
    ['logo', 'javascript:alert(1)'],
    ['logo', 'http://example.com/a.png'],
    ['logo', '/other/a.png'],
    ['href', 'javascript:alert(1)'],
    ['href', 'http://example.com'],
    ['placements', ['home', 'mars']],
    ['order', 1000],
    ['order', 1.5],
    ['name', 'x'],
    ['category', 'x'],
    ['bogus', 1],
  ])('rejects %s=%p', async (key, value) => {
    expect((await check(CreatePartnerDto, { ...base, [key]: value })).length).toBeGreaterThan(0);
  });
});

describe('ListPartnersDto', () => {
  it('defaults limit to 24 and caps at 48', async () => {
    expect(plainToInstance(ListPartnersDto, {}).limit).toBe(24);
    expect(await check(ListPartnersDto, { limit: '48', placement: 'home' })).toHaveLength(0);
    expect((await check(ListPartnersDto, { limit: '49' })).length).toBeGreaterThan(0);
    expect((await check(ListPartnersDto, { placement: 'x' })).length).toBeGreaterThan(0);
  });
});
