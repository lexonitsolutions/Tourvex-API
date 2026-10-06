import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCruiseEnquiryDto } from './create-enquiry.dto';

const valid = {
  fullName: 'Test Traveller',
  email: 'traveller@example.com',
  phone: '+971 50 123 4567',
  nationality: 'Indian',
  adults: 2,
  children: 1,
  departureDate: '2026-11-14',
  cabinType: 'Balcony',
  message: 'Planning a family cruise.',
  consent: true,
};

function errorsFor(overrides: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateCruiseEnquiryDto, { ...valid, ...overrides });
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

describe('CreateCruiseEnquiryDto', () => {
  it('accepts a complete valid enquiry and a minimal one', () => {
    expect(errorsFor({})).toEqual([]);
    const minimal: Record<string, unknown> = { ...valid };
    for (const key of ['departureDate', 'cabinType', 'message']) delete minimal[key];
    const dto = plainToInstance(CreateCruiseEnquiryDto, minimal);
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('requires consent to be exactly true', () => {
    expect(errorsFor({ consent: false })).toContain('consent');
    expect(errorsFor({ consent: 'true' })).toContain('consent');
    expect(errorsFor({ consent: undefined })).toContain('consent');
  });

  it('bounds adults 1-10 and children 0-10 as integers', () => {
    expect(errorsFor({ adults: 0 })).toContain('adults');
    expect(errorsFor({ adults: 11 })).toContain('adults');
    expect(errorsFor({ adults: 1.5 })).toContain('adults');
    expect(errorsFor({ adults: 10, children: 0 })).toEqual([]);
    expect(errorsFor({ children: -1 })).toContain('children');
    expect(errorsFor({ children: 11 })).toContain('children');
  });

  it('requires a well-formed ISO departureDate when present', () => {
    expect(errorsFor({ departureDate: 'tomorrow' })).toContain('departureDate');
    expect(errorsFor({ departureDate: '2026-02-30' })).toContain('departureDate');
  });

  it('validates name, email, phone, nationality, cabin type and message', () => {
    expect(errorsFor({ fullName: 'A' })).toContain('fullName');
    expect(errorsFor({ email: 'nope' })).toContain('email');
    expect(errorsFor({ phone: 'call me' })).toContain('phone');
    expect(errorsFor({ phone: '12345' })).toContain('phone');
    expect(errorsFor({ nationality: 'X' })).toContain('nationality');
    expect(errorsFor({ cabinType: 'x'.repeat(61) })).toContain('cabinType');
    expect(errorsFor({ message: 'x'.repeat(1001) })).toContain('message');
  });

  it('rejects unknown fields', () => {
    expect(errorsFor({ status: 'closed' })).toContain('status');
    expect(errorsFor({ cruiseId: 'x' })).toContain('cruiseId');
  });
});
