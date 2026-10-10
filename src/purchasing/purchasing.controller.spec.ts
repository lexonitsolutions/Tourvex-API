import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PermissionsGuard } from '../admin/permissions.guard';
import { PERMISSION_KEY } from '../admin/require-permission.decorator';
import { Role } from '../common/enums/role.enum';
import {
  CreatePurchaseDto,
  CreateSupplierDto,
  ListPurchasesDto,
  ListSuppliersDto,
  MarkPaidDto,
  UpdatePurchaseDto,
  UpdateSupplierDto,
} from './dto/purchasing.dto';
import { PurchasingController } from './purchasing.controller';

function errors<T extends object>(cls: new () => T, value: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(cls, value), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

const handlerOf = (name: keyof PurchasingController): object => (PurchasingController.prototype as unknown as Record<string, object>)[name];

describe('PurchasingController permissions', () => {
  const guard = new PermissionsGuard(new Reflector());
  const allowed = (handler: keyof PurchasingController, roles: string[]) => {
    const context = {
      getHandler: () => handlerOf(handler),
      getClass: () => PurchasingController,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    };
    try {
      return guard.canActivate(context as never);
    } catch {
      return false;
    }
  };

  const reads: (keyof PurchasingController)[] = ['listSuppliers', 'getSupplier', 'summary', 'listPurchases', 'getPurchase'];
  const writes: (keyof PurchasingController)[] = [
    'createSupplier',
    'updateSupplier',
    'deleteSupplier',
    'createPurchase',
    'updatePurchase',
    'receive',
    'void',
    'markPaid',
  ];

  it('guards every handler with the right permission', () => {
    for (const handler of reads) expect(Reflect.getMetadata(PERMISSION_KEY, handlerOf(handler))).toEqual(['purchasing.read']);
    for (const handler of writes) expect(Reflect.getMetadata(PERMISSION_KEY, handlerOf(handler))).toEqual(['purchasing.write']);
  });

  it('lets finance, operations and admins read and write', () => {
    for (const role of [Role.Finance, Role.Operations, Role.Admin, Role.SuperAdmin]) {
      for (const handler of [...reads, ...writes]) expect(allowed(handler, [role])).toBe(true);
    }
  });

  it('keeps sales, support, content and customers out', () => {
    for (const role of [Role.Sales, Role.Support, Role.Content, Role.Customer, Role.B2BOwner]) {
      for (const handler of [...reads, ...writes]) expect(allowed(handler, [role])).toBe(false);
    }
  });
});

describe('purchasing DTO validation', () => {
  const line = { itemId: 'activity:burj:adult', quantity: 10, dateFrom: '2026-11-01', dateTo: '2026-11-30', unitCost: 12.5 };
  const purchase = { supplierId: '64b7f0f2a1b2c3d4e5f60718', invoiceDate: '2026-10-10', lines: [line] };

  it('accepts a valid purchase and rejects unknown fields', () => {
    expect(errors(CreatePurchaseDto, purchase)).toEqual([]);
    expect(errors(CreatePurchaseDto, { ...purchase, status: 'received' })).toEqual(['status']);
  });

  it('limits quantity, cost precision, weekdays and the number of lines', () => {
    const bad = (patch: Record<string, unknown>) => errors(CreatePurchaseDto, { ...purchase, lines: [{ ...line, ...patch }] });
    expect(bad({ quantity: 0 })).toEqual(['lines']);
    expect(bad({ quantity: 1.5 })).toEqual(['lines']);
    expect(bad({ unitCost: -1 })).toEqual(['lines']);
    expect(bad({ unitCost: 1.234 })).toEqual(['lines']);
    expect(bad({ weekdays: [7] })).toEqual(['lines']);
    expect(bad({ weekdays: [1, 1] })).toEqual(['lines']);
    expect(bad({ dateFrom: '01/11/2026' })).toEqual(['lines']);
    expect(bad({ lineTotal: 5 })).toEqual(['lines']);
    expect(errors(CreatePurchaseDto, { ...purchase, lines: [] })).toEqual(['lines']);
    expect(errors(CreatePurchaseDto, { ...purchase, lines: Array.from({ length: 51 }, () => line) })).toEqual(['lines']);
    expect(errors(CreatePurchaseDto, { ...purchase, supplierId: 'nope' })).toEqual(['supplierId']);
  });

  it('draft edits are partial', () => {
    expect(errors(UpdatePurchaseDto, { notes: 'x' })).toEqual([]);
    expect(errors(UpdatePurchaseDto, { dueDate: '' })).toEqual([]);
    expect(errors(UpdatePurchaseDto, { lines: [] })).toEqual(['lines']);
  });

  it('suppliers need a two-letter country (upper-cased) and a name', () => {
    expect(errors(CreateSupplierDto, { name: 'Acme', country: 'ae' })).toEqual([]);
    expect(plainToInstance(CreateSupplierDto, { name: ' Acme ', country: 'ae' })).toMatchObject({ name: 'Acme', country: 'AE' });
    expect(errors(CreateSupplierDto, { name: 'Acme', country: 'ARE' })).toEqual(['country']);
    expect(errors(CreateSupplierDto, { country: 'AE' })).toEqual(['name']);
    expect(errors(CreateSupplierDto, { name: 'Acme', country: 'AE', email: 'bad' })).toEqual(['email']);
    expect(errors(CreateSupplierDto, { name: 'Acme', country: 'AE', paymentTermsDays: 400 })).toEqual(['paymentTermsDays']);
    expect(errors(UpdateSupplierDto, { email: '' })).toEqual([]);
    expect(errors(UpdateSupplierDto, { active: false })).toEqual([]);
  });

  it('lists default to 25 rows and allow up to 200', () => {
    expect(plainToInstance(ListSuppliersDto, {})).toMatchObject({ page: 1, limit: 25 });
    expect(errors(ListSuppliersDto, { limit: '200', active: 'true' })).toEqual([]);
    expect(errors(ListSuppliersDto, { limit: '201' })).toEqual(['limit']);
    expect(errors(ListPurchasesDto, { status: 'received', supplierId: '64b7f0f2a1b2c3d4e5f60718', from: '2026-10-01', to: '2026-10-31', limit: '200' })).toEqual([]);
    expect(errors(ListPurchasesDto, { status: 'weird' })).toEqual(['status']);
  });

  it('mark-paid takes an optional date and reference', () => {
    expect(errors(MarkPaidDto, {})).toEqual([]);
    expect(errors(MarkPaidDto, { paidAt: '2026-10-10', reference: 'TT-123' })).toEqual([]);
    expect(errors(MarkPaidDto, { paidAt: 'yesterday' })).toEqual(['paidAt']);
  });
});
