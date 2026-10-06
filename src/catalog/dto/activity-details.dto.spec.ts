import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AvailabilityQueryDto, QuoteDto } from './activity-booking.dto';
import { UpdateActivityDetailsDto } from './update-activity-details.dto';

function errors<T extends object>(cls: new () => T, value: Record<string, unknown>): string[] {
  const dto = plainToInstance(cls, value);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

describe('AvailabilityQueryDto', () => {
  it('requires a valid optionId and a YYYY-MM month', () => {
    expect(errors(AvailabilityQueryDto, { optionId: 'standard-entry', month: '2026-10' })).toEqual([]);
    expect(errors(AvailabilityQueryDto, { month: '2026-10' })).toContain('optionId');
    expect(errors(AvailabilityQueryDto, { optionId: 'a', month: '2026-13' })).toContain('month');
    expect(errors(AvailabilityQueryDto, { optionId: 'a', month: '2026-1' })).toContain('month');
    expect(errors(AvailabilityQueryDto, { optionId: 'A B', month: '2026-10' })).toContain('optionId');
  });
});

describe('QuoteDto', () => {
  const valid = { optionId: 'standard-entry', date: '2026-10-10', adults: 2, children: 1 };

  it('accepts a valid quote request', () => {
    expect(errors(QuoteDto, valid)).toEqual([]);
  });

  it('rejects bad dates and counts', () => {
    expect(errors(QuoteDto, { ...valid, date: '2026/10/10' })).toContain('date');
    expect(errors(QuoteDto, { ...valid, adults: 0 })).toContain('adults');
    expect(errors(QuoteDto, { ...valid, adults: 51 })).toContain('adults');
    expect(errors(QuoteDto, { ...valid, children: -1 })).toContain('children');
    expect(errors(QuoteDto, { ...valid, children: undefined })).toContain('children');
  });
});

describe('UpdateActivityDetailsDto', () => {
  const option = {
    id: 'standard-entry',
    name: 'Standard entry',
    transferType: 'none',
    adultPrice: { amount: 100, currency: 'AED' },
    childPrice: { amount: 70, currency: 'AED' },
    minPax: 1,
    maxPax: 10,
    pickupRequired: false,
    refundable: true,
    freeCancellationHours: 24,
    operatingWeekdays: [0, 1, 2],
    blackoutDates: ['2026-12-25'],
    dailyCapacity: 100,
    cutoffHours: 2,
  };

  it('accepts an empty patch and a full detail block', () => {
    expect(errors(UpdateActivityDetailsDto, {})).toEqual([]);
    expect(
      errors(UpdateActivityDetailsDto, {
        gallery: [{ url: 'https://example.com/a.jpg', alt: 'A' }],
        description: 'One.\n\nTwo.',
        highlights: ['a'],
        location: { name: 'Place', address: 'Somewhere', lat: 25.2, lng: 55.3 },
        freeCancellationHours: null,
        options: [option, { ...option, id: 'other', childPrice: null, dailyCapacity: null }],
      }),
    ).toEqual([]);
  });

  it('validates nested options', () => {
    const bad = (over: Record<string, unknown>) =>
      errors(UpdateActivityDetailsDto, { options: [{ ...option, ...over }] });
    expect(bad({ transferType: 'helicopter' })).toContain('options');
    expect(bad({ adultPrice: { amount: -1, currency: 'AED' } })).toContain('options');
    expect(bad({ adultPrice: { amount: 10, currency: 'USD' } })).toContain('options');
    expect(bad({ operatingWeekdays: [7] })).toContain('options');
    expect(bad({ operatingWeekdays: [] })).toContain('options');
    expect(bad({ blackoutDates: ['25-12-2026'] })).toContain('options');
    expect(bad({ id: 'Bad Id' })).toContain('options');
    expect(bad({ minPax: 0 })).toContain('options');
  });

  it('rejects non-https gallery URLs, oversize lists and unknown fields', () => {
    expect(errors(UpdateActivityDetailsDto, { gallery: [{ url: 'javascript:alert(1)', alt: 'x' }] })).toContain('gallery');
    expect(
      errors(UpdateActivityDetailsDto, {
        gallery: Array.from({ length: 13 }, () => ({ url: 'https://example.com/a.jpg', alt: 'x' })),
      }),
    ).toContain('gallery');
    expect(errors(UpdateActivityDetailsDto, { published: false })).toContain('published');
    expect(errors(UpdateActivityDetailsDto, { freeCancellationHours: -1 })).toContain('freeCancellationHours');
  });
});
