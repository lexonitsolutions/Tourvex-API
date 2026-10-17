import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateHolidayEnquiryDto } from './create-enquiry.dto';

const valid = {
  fullName: 'Test Traveller', email: 'traveller@example.com', phone: '+971 50 123 4567',
  travelers: 4, travelDate: '2026-11-14', returnDate: '2026-11-20', adults: 2, children: 2,
  childAges: [6, 10], departureCity: 'Dubai', rooms: 2, hotelCategory: '5 star',
  customization: 'Airport transfers and a birthday dinner.', consent: true,
};

function errorsFor(overrides: Record<string, unknown>) {
  return validateSync(plainToInstance(CreateHolidayEnquiryDto, { ...valid, ...overrides }), {
    whitelist: true, forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

describe('CreateHolidayEnquiryDto structured travel requirements', () => {
  it('accepts a complete request', () => expect(errorsFor({})).toEqual([]));
  it('bounds rooms and child ages', () => {
    expect(errorsFor({ rooms: 0 })).toContain('rooms');
    expect(errorsFor({ rooms: 21 })).toContain('rooms');
    expect(errorsFor({ childAges: [6, 18] })).toContain('childAges');
    expect(errorsFor({ childAges: '6,10' })).toContain('childAges');
  });
  it('validates return date and customization limits', () => {
    expect(errorsFor({ returnDate: 'next week' })).toContain('returnDate');
    expect(errorsFor({ customization: 'x'.repeat(2001) })).toContain('customization');
  });
});
