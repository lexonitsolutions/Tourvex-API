import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PermissionsGuard } from '../admin/permissions.guard';
import { PERMISSION_KEY } from '../admin/require-permission.decorator';
import { Role } from '../common/enums/role.enum';
import {
  CreateStockItemDto,
  EnquiryBookingDto,
  ListMovementsDto,
  ListStockItemsDto,
  ReturnToStockDto,
  UpdateStockDaysDto,
  UpdateStockItemDto,
} from './dto/stock.dto';
import { StockController } from './stock.controller';

function errors<T extends object>(cls: new () => T, value: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(cls, value), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

const handlerOf = (name: keyof StockController): object => (StockController.prototype as unknown as Record<string, object>)[name];

describe('StockController permissions', () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);
  const allowed = (handler: keyof StockController, roles: string[]) => {
    const context = {
      getHandler: () => handlerOf(handler),
      getClass: () => StockController,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    };
    try {
      return guard.canActivate(context as never);
    } catch {
      return false;
    }
  };

  const reads: (keyof StockController)[] = ['summary', 'listItems', 'movements', 'item'];
  const writes: (keyof StockController)[] = ['updateItem', 'updateDays', 'createItem', 'returnToStock', 'confirmEnquiry'];

  it('guards every handler with a permission', () => {
    for (const handler of [...reads, ...writes]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, handlerOf(handler))).toBeDefined();
    }
  });

  const stockWrites = writes.filter((h) => h !== 'confirmEnquiry');

  it('lets stock readers read but not edit stock, and customers do neither', () => {
    for (const role of [Role.Content, Role.Sales, Role.Support, Role.Finance]) {
      for (const handler of reads) expect(allowed(handler, [role])).toBe(true);
      for (const handler of stockWrites) expect(allowed(handler, [role])).toBe(false);
    }
    for (const handler of [...reads, ...writes]) expect(allowed(handler, [Role.Customer])).toBe(false);
  });

  it('lets operations edit stock', () => {
    for (const handler of stockWrites) expect(allowed(handler, [Role.Operations])).toBe(true);
  });

  it('confirming an enquiry into a booking is an enquiry action: sales and admins can, others cannot', () => {
    expect(allowed('confirmEnquiry', [Role.Sales])).toBe(true);
    expect(allowed('confirmEnquiry', [Role.Admin])).toBe(true);
    expect(allowed('confirmEnquiry', [Role.Operations, Role.Sales])).toBe(true);
    for (const role of [Role.Operations, Role.Content, Role.Support, Role.Finance, Role.Customer]) {
      expect(allowed('confirmEnquiry', [role])).toBe(false);
    }
  });
});

describe('stock DTO validation', () => {
  it('list items: validates type, status, sort and paging', () => {
    expect(errors(ListStockItemsDto, { type: 'activity', status: 'low', sort: 'attention', page: '2', limit: '50' })).toEqual([]);
    expect(errors(ListStockItemsDto, { type: 'spaceship' })).toContain('type');
    expect(errors(ListStockItemsDto, { status: 'broken' })).toContain('status');
    expect(errors(ListStockItemsDto, { sort: 'price' })).toContain('sort');
    expect(errors(ListStockItemsDto, { limit: '101' })).toContain('limit');
  });

  it('patch: capacity may be null (unlimited) or a non-negative integer', () => {
    expect(errors(UpdateStockItemDto, { defaultCapacity: null, stopSale: true, reason: 'x' })).toEqual([]);
    expect(errors(UpdateStockItemDto, { defaultCapacity: 200, lowStockThreshold: 10, unitCost: 12.5 })).toEqual([]);
    expect(errors(UpdateStockItemDto, { defaultCapacity: -1 })).toContain('defaultCapacity');
    expect(errors(UpdateStockItemDto, { defaultCapacity: 1.5 })).toContain('defaultCapacity');
    expect(errors(UpdateStockItemDto, { stopSale: 'yes' })).toContain('stopSale');
    expect(errors(UpdateStockItemDto, { reason: 'x'.repeat(301) })).toContain('reason');
    expect(errors(UpdateStockItemDto, { sold: 3 })).toContain('sold');
  });

  it('days: validates dates, weekdays 0-6, mode and capacity; set may omit capacity', () => {
    const ok = { from: '2030-01-10', to: '2030-01-20', mode: 'set', capacity: 50 };
    expect(errors(UpdateStockDaysDto, ok)).toEqual([]);
    expect(errors(UpdateStockDaysDto, { from: '2030-01-10', to: '2030-01-20', mode: 'set', closed: true })).toEqual([]);
    expect(errors(UpdateStockDaysDto, { ...ok, weekdays: [0, 6] })).toEqual([]);
    expect(errors(UpdateStockDaysDto, { ...ok, weekdays: [7] })).toContain('weekdays');
    expect(errors(UpdateStockDaysDto, { ...ok, mode: 'multiply' })).toContain('mode');
    expect(errors(UpdateStockDaysDto, { ...ok, capacity: -5 })).toContain('capacity');
    expect(errors(UpdateStockDaysDto, { ...ok, from: '10/01/2030' })).toContain('from');
  });

  it('create manual item: only manual types, slug refs, capacity number or null', () => {
    const ok = { productType: 'yacht', productRef: 'sunset-yacht', title: 'Sunset yacht', defaultCapacity: 12 };
    expect(errors(CreateStockItemDto, ok)).toEqual([]);
    expect(errors(CreateStockItemDto, { ...ok, defaultCapacity: null })).toEqual([]);
    expect(errors(CreateStockItemDto, { ...ok, productType: 'activity' })).toContain('productType');
    expect(errors(CreateStockItemDto, { ...ok, productRef: 'Not A Slug' })).toContain('productRef');
    expect(errors(CreateStockItemDto, { ...ok, title: '' })).toContain('title');
    const missing: Record<string, unknown> = { ...ok };
    delete missing.defaultCapacity;
    expect(errors(CreateStockItemDto, missing)).toContain('defaultCapacity');
  });

  it('movements and return-to-stock', () => {
    expect(errors(ListMovementsDto, { type: 'restock_manual', from: '2030-01-01', to: '2030-01-31' })).toEqual([]);
    expect(errors(ListMovementsDto, { type: 'nope' })).toContain('type');
    expect(errors(ReturnToStockDto, { reason: 'Customer rebooked' })).toEqual([]);
    expect(errors(ReturnToStockDto, { reason: '  ' })).toContain('reason');
  });

  it('enquiry booking: validates source, ids, pax, amount, currency and payment mode', () => {
    const ok = {
      source: 'cruise',
      enquiryId: 'a'.repeat(24),
      variantId: 'Balcony',
      serviceDay: '2030-03-01',
      quantity: 2,
      totalAmount: 1500,
      currency: 'aed',
      paymentMode: 'bank_transfer',
    };
    expect(errors(EnquiryBookingDto, ok)).toEqual([]);
    expect(errors(EnquiryBookingDto, { ...ok, source: 'visa' })).toContain('source');
    expect(errors(EnquiryBookingDto, { ...ok, enquiryId: 'nope' })).toContain('enquiryId');
    expect(errors(EnquiryBookingDto, { ...ok, quantity: 0 })).toContain('quantity');
    expect(errors(EnquiryBookingDto, { ...ok, totalAmount: -1 })).toContain('totalAmount');
    expect(errors(EnquiryBookingDto, { ...ok, currency: 'dirham' })).toContain('currency');
    expect(errors(EnquiryBookingDto, { ...ok, paymentMode: 'crypto' })).toContain('paymentMode');
    expect(errors(EnquiryBookingDto, { ...ok, note: 'x'.repeat(1001) })).toContain('note');
  });
});
