import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateEventEnquiryDto } from './create-enquiry.dto';

const valid = {
  fullName: 'Test Visitor',
  email: 'visitor@example.com',
  phone: '+971 50 123 4567',
  tickets: 2,
  ticketType: 'General Admission',
  sessionId: '665f1c2b9a1e4b0012345678',
  message: 'Two tickets please.',
  consent: true,
};

function errorsFor(overrides: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateEventEnquiryDto, { ...valid, ...overrides });
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

describe('CreateEventEnquiryDto', () => {
  it('accepts a complete valid enquiry and a minimal one', () => {
    expect(errorsFor({})).toEqual([]);
    const minimal: Record<string, unknown> = { ...valid };
    for (const key of ['ticketType', 'sessionId', 'message']) delete minimal[key];
    const dto = plainToInstance(CreateEventEnquiryDto, minimal);
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('requires consent to be exactly true', () => {
    expect(errorsFor({ consent: false })).toContain('consent');
    expect(errorsFor({ consent: 'true' })).toContain('consent');
    expect(errorsFor({ consent: undefined })).toContain('consent');
  });

  it('bounds tickets 1-20 as an integer', () => {
    expect(errorsFor({ tickets: 0 })).toContain('tickets');
    expect(errorsFor({ tickets: 21 })).toContain('tickets');
    expect(errorsFor({ tickets: 1.5 })).toContain('tickets');
    expect(errorsFor({ tickets: 20 })).toEqual([]);
  });

  it('requires a well-formed sessionId when present', () => {
    expect(errorsFor({ sessionId: 'not-an-id' })).toContain('sessionId');
  });

  it('validates name, email, phone, ticket type and message', () => {
    expect(errorsFor({ fullName: 'A' })).toContain('fullName');
    expect(errorsFor({ email: 'nope' })).toContain('email');
    expect(errorsFor({ phone: 'call me' })).toContain('phone');
    expect(errorsFor({ phone: '12345' })).toContain('phone');
    expect(errorsFor({ ticketType: 'x'.repeat(61) })).toContain('ticketType');
    expect(errorsFor({ message: 'x'.repeat(1001) })).toContain('message');
  });

  it('rejects unknown fields', () => {
    expect(errorsFor({ status: 'closed' })).toContain('status');
    expect(errorsFor({ eventId: 'x' })).toContain('eventId');
  });
});
