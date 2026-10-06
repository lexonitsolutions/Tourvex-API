import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateVisaEnquiryDto } from './create-enquiry.dto';

const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

const valid = {
  fullName: 'Test Traveller',
  email: 'traveller@example.com',
  phone: '+971 50 123 4567',
  nationality: 'Indian',
  travellers: 2,
  travelDate: future,
  message: 'Planning a short trip.',
  consent: true,
};

function errorsFor(overrides: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateVisaEnquiryDto, { ...valid, ...overrides });
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

describe('CreateVisaEnquiryDto', () => {
  it('accepts a complete valid enquiry and a minimal one', () => {
    expect(errorsFor({})).toEqual([]);
    const minimal: Record<string, unknown> = { ...valid };
    delete minimal.travelDate;
    delete minimal.message;
    const dto = plainToInstance(CreateVisaEnquiryDto, minimal);
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('requires consent to be exactly true', () => {
    expect(errorsFor({ consent: false })).toContain('consent');
    expect(errorsFor({ consent: 'true' })).toContain('consent');
    expect(errorsFor({ consent: undefined })).toContain('consent');
  });

  it('rejects a travel date in the past but allows today', () => {
    expect(errorsFor({ travelDate: past })).toContain('travelDate');
    expect(errorsFor({ travelDate: new Date().toISOString().slice(0, 10) })).toEqual([]);
    expect(errorsFor({ travelDate: 'tomorrow' })).toContain('travelDate');
  });

  it('validates name, email, phone, nationality and traveller bounds', () => {
    expect(errorsFor({ fullName: 'A' })).toContain('fullName');
    expect(errorsFor({ email: 'nope' })).toContain('email');
    expect(errorsFor({ phone: 'call me' })).toContain('phone');
    expect(errorsFor({ phone: '12345' })).toContain('phone');
    expect(errorsFor({ nationality: 'X' })).toContain('nationality');
    expect(errorsFor({ travellers: 0 })).toContain('travellers');
    expect(errorsFor({ travellers: 21 })).toContain('travellers');
    expect(errorsFor({ travellers: 1.5 })).toContain('travellers');
    expect(errorsFor({ message: 'x'.repeat(1001) })).toContain('message');
  });

  it('rejects unknown fields', () => {
    expect(errorsFor({ status: 'closed' })).toContain('status');
  });
});
