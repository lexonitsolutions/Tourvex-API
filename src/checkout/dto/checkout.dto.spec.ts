import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AdditionalDto,
  ApplyPromoDto,
  CartItemDto,
  CustomerDto,
  PickupDto,
  UpsertPromoDto,
} from './checkout.dto';

function errors<T extends object>(cls: new () => T, value: Record<string, unknown>): string[] {
  const dto = plainToInstance(cls, value);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

describe('CartItemDto', () => {
  const valid = {
    activitySlug: 'dubai-frame',
    optionId: 'standard-entry',
    date: '2026-10-10',
    adults: 2,
    children: 0,
  };

  it('accepts a valid item', () => {
    expect(errors(CartItemDto, valid)).toEqual([]);
  });

  it('validates slug, option, date and traveller counts', () => {
    expect(errors(CartItemDto, { ...valid, activitySlug: 'Not A Slug' })).toContain('activitySlug');
    expect(errors(CartItemDto, { ...valid, optionId: '../x' })).toContain('optionId');
    expect(errors(CartItemDto, { ...valid, date: '10/10/2026' })).toContain('date');
    expect(errors(CartItemDto, { ...valid, adults: 0 })).toContain('adults');
    expect(errors(CartItemDto, { ...valid, children: -1 })).toContain('children');
    expect(errors(CartItemDto, { ...valid, adults: 1.5 })).toContain('adults');
  });

  it('never accepts client-sent amounts', () => {
    expect(errors(CartItemDto, { ...valid, total: 1 })).toContain('total');
    expect(errors(CartItemDto, { ...valid, price: { amount: 1 } })).toContain('price');
  });
});

describe('PickupDto', () => {
  it('requires a location and address for "now" and nothing for "later"', () => {
    expect(errors(PickupDto, { mode: 'later' })).toEqual([]);
    expect(errors(PickupDto, { mode: 'now' })).toEqual(expect.arrayContaining(['locationName', 'address']));
    expect(
      errors(PickupDto, { mode: 'now', locationName: 'Hotel Sample', address: 'Marina, Dubai', lat: 25.1, lng: 55.1 }),
    ).toEqual([]);
  });

  it('rejects bad modes, coordinates and unknown fields', () => {
    expect(errors(PickupDto, { mode: 'soon' })).toContain('mode');
    expect(errors(PickupDto, { mode: 'later', lat: 91 })).toContain('lat');
    expect(errors(PickupDto, { mode: 'later', extra: true })).toContain('extra');
  });
});

describe('AdditionalDto', () => {
  it('accepts an empty body (marks the step done) and the whitelisted fields', () => {
    expect(errors(AdditionalDto, {})).toEqual([]);
    expect(
      errors(AdditionalDto, {
        leadTravellerNames: ['Alex Sample'],
        specialRequests: 'Vegetarian meal',
        arrivalFlight: 'XY123',
        hotelName: 'Hotel Sample',
      }),
    ).toEqual([]);
  });

  it('enforces the length limits and the strict whitelist', () => {
    expect(errors(AdditionalDto, { specialRequests: 'x'.repeat(501) })).toContain('specialRequests');
    expect(errors(AdditionalDto, { arrivalFlight: 'x'.repeat(41) })).toContain('arrivalFlight');
    expect(errors(AdditionalDto, { hotelName: 'x'.repeat(121) })).toContain('hotelName');
    expect(errors(AdditionalDto, { leadTravellerNames: ['x'.repeat(121)] })).toContain('leadTravellerNames');
    expect(errors(AdditionalDto, { cardNumber: '4242424242424242' })).toContain('cardNumber');
  });
});

describe('CustomerDto', () => {
  const valid = {
    fullName: 'Alex Sample',
    email: 'alex@example.com',
    phoneCountryCode: '+971',
    phone: '501234567',
    nationality: 'India',
    marketingOptOut: false,
  };

  it('accepts a complete customer', () => {
    expect(errors(CustomerDto, valid)).toEqual([]);
  });

  it('validates every field', () => {
    expect(errors(CustomerDto, { ...valid, fullName: 'A' })).toContain('fullName');
    expect(errors(CustomerDto, { ...valid, fullName: 'x'.repeat(121) })).toContain('fullName');
    expect(errors(CustomerDto, { ...valid, email: 'nope' })).toContain('email');
    expect(errors(CustomerDto, { ...valid, phoneCountryCode: '971' })).toContain('phoneCountryCode');
    expect(errors(CustomerDto, { ...valid, phone: '12345' })).toContain('phone');
    expect(errors(CustomerDto, { ...valid, phone: '12345678901234567' })).toContain('phone');
    expect(errors(CustomerDto, { ...valid, phone: '50 123 4567' })).toContain('phone');
    expect(errors(CustomerDto, { ...valid, nationality: 'I' })).toContain('nationality');
    expect(errors(CustomerDto, { ...valid, marketingOptOut: 'no' })).toContain('marketingOptOut');
    expect(errors(CustomerDto, { ...valid, marketingOptOut: undefined })).toContain('marketingOptOut');
  });
});

describe('ApplyPromoDto', () => {
  it('upper-cases and trims the code', () => {
    const dto = plainToInstance(ApplyPromoDto, { code: '  welcome10 ' });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.code).toBe('WELCOME10');
  });

  it('rejects odd characters and bad lengths', () => {
    expect(errors(ApplyPromoDto, { code: 'a b' })).toContain('code');
    expect(errors(ApplyPromoDto, { code: 'ab' })).toContain('code');
    expect(errors(ApplyPromoDto, { code: '<script>' })).toContain('code');
  });
});

describe('UpsertPromoDto', () => {
  const valid = { code: 'SPRING5', type: 'percent', value: 5 };

  it('accepts a minimal and a full promo', () => {
    expect(errors(UpsertPromoDto, valid)).toEqual([]);
    expect(
      errors(UpsertPromoDto, {
        ...valid,
        minSubtotal: 100,
        maxDiscount: 50,
        usageLimit: 100,
        appliesTo: ['dubai-frame'],
        validFrom: '2026-10-01T00:00:00.000Z',
        validTo: '2026-12-31T00:00:00.000Z',
      }),
    ).toEqual([]);
  });

  it('rejects bad types, values, dates and unknown fields', () => {
    expect(errors(UpsertPromoDto, { ...valid, type: 'bogus' })).toContain('type');
    expect(errors(UpsertPromoDto, { ...valid, value: 0 })).toContain('value');
    expect(errors(UpsertPromoDto, { ...valid, validTo: 'soon' })).toContain('validTo');
    expect(errors(UpsertPromoDto, { ...valid, usedCount: 99 })).toContain('usedCount');
  });
});
