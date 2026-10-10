import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PermissionsGuard } from '../admin/permissions.guard';
import { PERMISSION_KEY } from '../admin/require-permission.decorator';
import { Role } from '../common/enums/role.enum';
import { AdminInvoicesController } from '../finance/finance.controller';
import { EnquiryBookingDto } from '../stock/dto/stock.dto';
import { CreateRegimeDto, CreateSellerDto, EmailInvoiceDto, TaxPreviewDto, UpdateRegimeDto, UpdateSellerDto, UpdateTaxSettingsDto } from './tax.dto';
import { TaxController } from './tax.controller';

const errors = <T extends object>(cls: new () => T, value: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(cls, value), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);

const guard = new PermissionsGuard(new Reflector());
const allowed = (controller: { prototype: object; name?: string }, handler: string, roles: string[]) => {
  const context = {
    getHandler: () => (controller.prototype as Record<string, object>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
  };
  try {
    return guard.canActivate(context as never);
  } catch {
    return false;
  }
};

describe('TaxController permissions', () => {
  const reads = ['regimes', 'sellers', 'settings', 'preview', 'countries'];
  const writes = ['createRegime', 'updateRegime', 'deleteRegime', 'createSeller', 'updateSeller', 'deleteSeller', 'updateSettings'];

  it('guards every handler', () => {
    for (const handler of [...reads, ...writes]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, (TaxController.prototype as unknown as Record<string, object>)[handler])).toBeDefined();
    }
  });

  it('lets finance and admins read and write, operations read only, everyone else nothing', () => {
    for (const role of [Role.Finance, Role.Admin, Role.SuperAdmin]) {
      for (const handler of [...reads, ...writes]) expect(allowed(TaxController, handler, [role])).toBe(true);
    }
    for (const handler of reads) expect(allowed(TaxController, handler, [Role.Operations])).toBe(true);
    for (const handler of writes) expect(allowed(TaxController, handler, [Role.Operations])).toBe(false);
    for (const role of [Role.Sales, Role.Support, Role.Content, Role.Customer, Role.B2BOwner]) {
      for (const handler of [...reads, ...writes]) expect(allowed(TaxController, handler, [role])).toBe(false);
    }
  });

  it('e-mailing an invoice needs invoices.write (finance and admins, not sales or support)', () => {
    expect(allowed(AdminInvoicesController, 'email', [Role.Finance])).toBe(true);
    expect(allowed(AdminInvoicesController, 'email', [Role.Admin])).toBe(true);
    for (const role of [Role.Sales, Role.Support, Role.Operations, Role.Customer]) expect(allowed(AdminInvoicesController, 'email', [role])).toBe(false);
  });
});

describe('tax DTO validation', () => {
  const regime = {
    country: 'ae',
    taxName: 'VAT',
    invoiceTitle: 'Tax Invoice',
    registrationLabel: 'TRN',
    model: 'single',
    rates: [{ code: 'standard', label: 'Standard 5%', percent: 5, isDefault: true }],
    numbering: { prefix: 'inv', creditPrefix: 'cn', includeCountry: false, yearDigits: 4, sequenceDigits: 6 },
  };

  it('accepts a regime (countryName is optional) and rejects bad rates, models and numbering', () => {
    expect(errors(CreateRegimeDto, regime)).toEqual([]);
    expect(errors(CreateRegimeDto, { ...regime, model: 'weird' })).toContain('model');
    expect(errors(CreateRegimeDto, { ...regime, rates: [] })).toContain('rates');
    expect(errors(CreateRegimeDto, { ...regime, rates: [{ code: 'x', label: 'x', percent: 101, isDefault: true }] })).toContain('rates');
    expect(errors(CreateRegimeDto, { ...regime, rates: [{ code: 'x', label: 'x', percent: 5.1234, isDefault: true }] })).toContain('rates');
    expect(errors(CreateRegimeDto, { ...regime, numbering: { ...regime.numbering, yearDigits: 3 } })).toContain('numbering');
    expect(errors(CreateRegimeDto, { ...regime, country: 'UAE' })).toContain('country');
    expect(errors(CreateRegimeDto, { ...regime, surprise: 1 })).toContain('surprise');
  });

  it('updates a regime partially, clears serviceCode with null, and refuses a country change', () => {
    expect(errors(UpdateRegimeDto, { taxName: 'GST' })).toEqual([]);
    expect(errors(UpdateRegimeDto, { serviceCode: null, invoiceNotes: '' })).toEqual([]);
    expect(errors(UpdateRegimeDto, { country: 'IN' })).toContain('country');
  });

  it('requires country, legalName and registrationNumber for a seller; the rest is optional', () => {
    expect(errors(CreateSellerDto, { country: 'IN', legalName: 'Karnish', registrationNumber: '32AAB' })).toEqual([]);
    expect(errors(CreateSellerDto, { country: 'IN' })).toEqual(expect.arrayContaining(['legalName', 'registrationNumber']));
    expect(errors(CreateSellerDto, { country: 'IN', legalName: 'K', registrationNumber: '1', stateCode: '3' })).toContain('stateCode');
    expect(errors(CreateSellerDto, { country: 'IN', legalName: 'K', registrationNumber: '1', bankDetails: 'x'.repeat(501) })).toContain('bankDetails');
    expect(errors(CreateSellerDto, { country: 'IN', legalName: 'K', registrationNumber: '1', email: 'nope' })).toContain('email');
    expect(errors(UpdateSellerDto, { isDefault: true })).toEqual([]);
  });

  it('validates settings, preview, e-mail and the enquiry confirm tax / buyer inputs', () => {
    expect(errors(UpdateTaxSettingsDto, { defaultCountry: 'AE', defaultRateFallbackPercent: 5 })).toEqual([]);
    expect(errors(UpdateTaxSettingsDto, { defaultRateFallbackPercent: 120 })).toContain('defaultRateFallbackPercent');
    expect(errors(TaxPreviewDto, { country: 'IN', amount: 100 })).toEqual([]);
    expect(errors(TaxPreviewDto, { country: 'IN', amount: -1 })).toContain('amount');
    expect(errors(EmailInvoiceDto, {})).toEqual([]);
    expect(errors(EmailInvoiceDto, { to: 'not-an-email' })).toContain('to');

    const confirm = { source: 'holiday', enquiryId: 'a'.repeat(24), variantId: 'default', serviceDay: '2026-11-05', quantity: 2, totalAmount: 1050, currency: 'AED', paymentMode: 'cash' };
    expect(errors(EnquiryBookingDto, confirm)).toEqual([]);
    expect(errors(EnquiryBookingDto, { ...confirm, tax: { country: 'IN', rateCode: 'gst18', placeOfSupplyStateCode: '32' }, buyer: { name: 'Ravi', registrationNumber: '32AAB' } })).toEqual([]);
    expect(errors(EnquiryBookingDto, { ...confirm, tax: { country: 'India' } })).toContain('tax');
    expect(errors(EnquiryBookingDto, { ...confirm, buyer: { stateCode: '3' } })).toContain('buyer');
  });
});
