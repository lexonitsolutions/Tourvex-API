import mongoose from 'mongoose';
import { AdminReportsService } from '../admin-reports/admin-reports.service';
import { BookingCostService } from '../bookings/booking-cost';
import { BookingsService } from '../bookings/bookings.service';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { addDays, operatingToday } from '../catalog/activity-booking.utils';
import { Activity, ActivitySchema } from '../catalog/schemas/activity.schema';
import { CapacityLock, CapacityLockSchema } from '../catalog/schemas/capacity-lock.schema';
import { CartSession, CartSessionSchema } from '../checkout/schemas/cart-session.schema';
import { TransactionService } from '../common/database/transaction.service';
import { Counter, CounterSchema } from '../crm/billing/schemas/counter.schema';
import { CruiseEnquiry, CruiseEnquirySchema } from '../cruises/schemas/cruise-enquiry.schema';
import { Cruise, CruiseSchema } from '../cruises/schemas/cruise.schema';
import { EventEnquiry, EventEnquirySchema } from '../events/schemas/event-enquiry.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { HolidayEnquiry, HolidayEnquirySchema } from '../holidays/schemas/holiday-enquiry.schema';
import { Holiday, HolidaySchema } from '../holidays/schemas/holiday.schema';
import { Lead, LeadSchema } from '../leads/lead.schema';
import { EnquiryBookingService } from '../stock/enquiry-booking.service';
import { StockAlertState, StockAlertStateSchema } from '../stock/schemas/stock-alert-state.schema';
import { StockDay, StockDaySchema } from '../stock/schemas/stock-day.schema';
import { StockMovement, StockMovementSchema } from '../stock/schemas/stock-movement.schema';
import { StockPolicy, StockPolicySchema } from '../stock/schemas/stock-policy.schema';
import { StockAdminService } from '../stock/stock-admin.service';
import { StockService } from '../stock/stock.service';
import type { EnquiryBookingDto } from '../stock/dto/stock.dto';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PurchasingService } from './purchasing.service';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';
import { Supplier, SupplierSchema } from './schemas/supplier.schema';
import type { CreatePurchaseDto } from './dto/purchasing.dto';

/**
 * Runs against a real MongoDB replica set in a throw-away database (dropped afterwards). Skipped when no replica set
 * is reachable, like the stock integration test.
 */
const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex?replicaSet=rs0';
const dbName = `tourvex_purchasing_test_${Date.now()}`;

let connection: mongoose.Connection | undefined;
let available = false;

type Harness = ReturnType<typeof build>;
let h: Harness;

function build(conn: mongoose.Connection) {
  const m = {
    activities: conn.model(Activity.name, ActivitySchema),
    holidays: conn.model(Holiday.name, HolidaySchema),
    cruises: conn.model(Cruise.name, CruiseSchema),
    events: conn.model(Event.name, EventSchema),
    bookings: conn.model(Booking.name, BookingSchema),
    carts: conn.model(CartSession.name, CartSessionSchema),
    locks: conn.model(CapacityLock.name, CapacityLockSchema),
    policies: conn.model(StockPolicy.name, StockPolicySchema),
    days: conn.model(StockDay.name, StockDaySchema),
    movements: conn.model(StockMovement.name, StockMovementSchema),
    alerts: conn.model(StockAlertState.name, StockAlertStateSchema),
    holidayEnquiries: conn.model(HolidayEnquiry.name, HolidayEnquirySchema),
    cruiseEnquiries: conn.model(CruiseEnquiry.name, CruiseEnquirySchema),
    eventEnquiries: conn.model(EventEnquiry.name, EventEnquirySchema),
    users: conn.model(User.name, UserSchema),
    leads: conn.model(Lead.name, LeadSchema),
    suppliers: conn.model(Supplier.name, SupplierSchema),
    purchases: conn.model(Purchase.name, PurchaseSchema),
    counters: conn.model(Counter.name, CounterSchema),
  };
  const notifications = { stockAlert: jest.fn().mockResolvedValue(undefined), bookingConfirmed: jest.fn().mockResolvedValue(undefined) };
  const cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
  const settings = { get: jest.fn().mockResolvedValue({ supportEmail: 'ops@example.com' }) };
  const config = { get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined) };
  const stock = new StockService(
    m.activities as never, m.holidays as never, m.cruises as never, m.events as never, m.bookings as never, m.carts as never,
    m.locks as never, m.policies as never, m.days as never, m.movements as never, m.alerts as never,
    notifications as never, settings as never, cache as never, config as never,
  );
  const transactions = new TransactionService(conn);
  const stockAdmin = new StockAdminService(stock, transactions, m.bookings as never);
  const purchasing = new PurchasingService(m.suppliers as never, m.purchases as never, m.counters as never, stock, stockAdmin, transactions);
  const bookingsService = new BookingsService(m.bookings as never, {} as never, {} as never, {} as never, {} as never, new BookingCostService(m.bookings as never, m.policies as never));
  jest.spyOn(bookingsService, 'afterConfirmed').mockResolvedValue(undefined);
  const enquiries = new EnquiryBookingService(
    m.holidayEnquiries as never, m.cruiseEnquiries as never, m.eventEnquiries as never, m.users as never, m.leads as never,
    stock, bookingsService, { findInvoiceForBooking: jest.fn().mockResolvedValue({ invoiceNumber: 'INV-1' }) } as never,
    { markWonFromEnquiry: jest.fn().mockResolvedValue(undefined) } as never, notifications as never, transactions,
    {
      countryForProduct: jest.fn().mockResolvedValue('AE'),
      determine: jest.fn().mockResolvedValue({
        regimeId: null, country: 'AE', taxName: 'VAT', model: 'single', rateCode: 'standard', percent: 5,
        components: [{ code: 'VAT', label: 'VAT', percent: 5 }], sellerId: null, placeOfSupply: { country: 'AE' },
        pricesIncludeTax: false, zeroRated: false, fallback: true,
      }),
    } as never,
  );
  const reports = new AdminReportsService(conn, {} as never);
  return { m, stock, stockAdmin, purchasing, enquiries, reports, transactions };
}

beforeAll(async () => {
  try {
    const candidate = mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 2_000 });
    await candidate.asPromise();
    const hello = await candidate.db!.admin().command({ hello: 1 });
    if (!hello.setName) throw new Error('not a replica set');
    connection = candidate;
    h = build(candidate);
    for (const model of Object.values(h.m)) {
      await model.createCollection();
      await model.syncIndexes();
    }
    available = true;
  } catch {
    available = false;
  }
}, 30_000);

afterAll(async () => {
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!available) return console.warn(`SKIPPED (no MongoDB replica set): ${name}`);
    await fn();
  }, 90_000);

const actor = { id: new mongoose.Types.ObjectId().toString(), email: 'finance@example.com' };
const today = () => operatingToday(new Date());
const soon = (days = 7) => addDays(today(), days);
let seq = 0;

async function supplier(name = `Supplier ${(seq += 1)}`) {
  return h.purchasing.createSupplier({ name, country: 'AE', paymentTermsDays: 30 });
}

const keyOf = (ref: string, type: 'custom' | 'holiday' = 'custom') => ({ productType: type, productRef: ref, variantId: 'default' as const });
const itemId = (ref: string, type: 'custom' | 'holiday' = 'custom') => `${type}:${ref}:default`;

async function customItem(ref: string, capacity: number) {
  await h.stockAdmin.createItem({ productType: 'custom', productRef: ref, title: `Item ${ref}`, defaultCapacity: capacity }, actor);
}

async function holiday(slug: string, capacity: number) {
  await h.m.holidays.create({ slug, title: `Holiday ${slug}`, country: 'Oman', durationNights: 2, durationDays: 3, published: true });
  await h.m.policies.create({ productType: 'holiday', productRef: slug, variantId: 'default', title: `Holiday ${slug}`, defaultCapacity: capacity });
}

async function draft(supplierId: string, lines: CreatePurchaseDto['lines'], extra: Partial<CreatePurchaseDto> = {}) {
  return h.purchasing.createPurchase({ supplierId, invoiceDate: today(), lines, ...extra }, actor);
}

const capacityOn = async (ref: string, day: string, type: 'custom' | 'holiday' = 'custom') =>
  (await h.stock.capacityInfo(keyOf(ref, type), null, day, day, new Date())).get(day)!;

async function enquiry(slug: string) {
  seq += 1;
  const doc = await h.m.holidayEnquiries.create({
    holidayId: new mongoose.Types.ObjectId(), holidaySlug: slug, reference: `HOL-P${Date.now()}${seq}`, fullName: `Guest ${seq}`,
    email: `guest${seq}.${Date.now()}@example.com`, phone: '+971500000000', consentAt: new Date(),
  });
  return doc._id.toString();
}

const confirmDto = (enquiryId: string, day: string, quantity: number, totalAmount: number): EnquiryBookingDto => ({
  source: 'holiday', enquiryId, variantId: 'default', serviceDay: day, quantity, totalAmount, currency: 'AED', paymentMode: 'cash',
});

describe('Purchasing against MongoDB', () => {
  maybe('purchase numbers are gap-free and unique under 20 concurrent creations, and a refused create burns none', async () => {
    await customItem('numbers', 1);
    const s = await supplier();
    const d = soon(5);
    const line = { itemId: itemId('numbers'), quantity: 1, dateFrom: d, dateTo: d, unitCost: 1 };
    const created = await Promise.all(Array.from({ length: 20 }, () => draft(s.id, [line])));
    const year = today().slice(0, 4);
    const numbers = created.map((p) => p.number).sort();
    expect(new Set(numbers).size).toBe(20);
    const first = Number(numbers[0].split('-')[2]);
    expect(first).toBe(1); // this test runs first on the fresh database
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => `PUR-${year}-${String(first + i).padStart(6, '0')}`));

    await draft(s.id, [line], { supplierInvoiceNumber: 'INV-DUP' });
    await expect(draft(s.id, [line], { supplierInvoiceNumber: 'INV-DUP' })).rejects.toMatchObject({ status: 409, response: { code: 'DUPLICATE_SUPPLIER_INVOICE' } });
    const next = await draft(s.id, [line]);
    expect(next.number).toBe(`PUR-${year}-${String(first + 21).padStart(6, '0')}`);
    // The same invoice number is fine for another supplier.
    const other = await supplier();
    await expect(draft(other.id, [line], { supplierInvoiceNumber: 'INV-DUP' })).resolves.toBeDefined();
  });

  maybe('receive adds exactly the units to the right dates, writes the ledger and sets the unit cost', async () => {
    await customItem('recv-1', 5);
    const s = await supplier();
    const d1 = soon(3);
    const p = await draft(s.id, [{ itemId: itemId('recv-1'), quantity: 10, dateFrom: d1, dateTo: addDays(d1, 2), unitCost: 12.5 }]);
    expect(p.status).toBe('draft');
    expect(p.lines[0]).toMatchObject({ totalUnits: 30, lineTotal: 375, title: 'Item recv-1' });
    expect(p.total).toBe(375);
    expect(p.dueDate).toBe(addDays(today(), 30));

    const out = await h.purchasing.receive(p.id, actor);
    expect(out.changed).toBe(true);
    expect(out.purchase.status).toBe('received');
    for (let i = 0; i < 3; i += 1) expect((await capacityOn('recv-1', addDays(d1, i))).limit).toBe(15);
    expect((await capacityOn('recv-1', addDays(d1, 3))).limit).toBe(5);
    expect((await capacityOn('recv-1', addDays(d1, -1))).limit).toBe(5);

    const rows = await h.m.movements.find({ productRef: 'recv-1', type: 'adjust_add' }).sort({ date: 1 }).lean();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ reason: `Purchase ${p.number}`, before: 5, after: 15, delta: 10, meta: { purchaseNumber: p.number } });
    const cost = await h.m.movements.find({ productRef: 'recv-1', type: 'set_cost' }).lean();
    expect(cost).toHaveLength(1);
    expect(cost[0].meta).toMatchObject({ purchaseNumber: p.number, unitCost: 12.5, previousUnitCost: null });
    expect((await h.m.policies.findOne(keyOf('recv-1')).lean())?.unitCost).toBe(12.5);
    // Searchable by purchase number in the ledger.
    const found = await h.stockAdmin.listMovements({ purchaseNumber: p.number, page: 1, limit: 50 });
    expect(found.items).toHaveLength(4);
  });

  maybe('weekday filters add units only to the matching dates', async () => {
    await customItem('recv-wd', 0);
    const s = await supplier();
    const from = soon(10);
    const wanted = new Date(`${from}T00:00:00Z`).getUTCDay();
    const p = await draft(s.id, [{ itemId: itemId('recv-wd'), quantity: 4, dateFrom: from, dateTo: addDays(from, 13), weekdays: [wanted], unitCost: 2 }]);
    expect(p.lines[0].totalUnits).toBe(8);
    await h.purchasing.receive(p.id, actor);
    expect((await capacityOn('recv-wd', from)).limit).toBe(4);
    expect((await capacityOn('recv-wd', addDays(from, 7))).limit).toBe(4);
    expect((await capacityOn('recv-wd', addDays(from, 1))).limit).toBe(0);
  });

  maybe('receive is idempotent and concurrent receives apply once', async () => {
    await customItem('recv-2', 0);
    const s = await supplier();
    const d = soon(4);
    const p = await draft(s.id, [{ itemId: itemId('recv-2'), quantity: 7, dateFrom: d, dateTo: d, unitCost: 3 }]);
    const results = await Promise.all(Array.from({ length: 5 }, () => h.purchasing.receive(p.id, actor)));
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect((await capacityOn('recv-2', d)).limit).toBe(7);
    const again = await h.purchasing.receive(p.id, actor);
    expect(again.changed).toBe(false);
    expect(again.purchase.status).toBe('received');
    expect((await capacityOn('recv-2', d)).limit).toBe(7);
    expect(await h.m.movements.countDocuments({ productRef: 'recv-2', type: 'adjust_add' })).toBe(1);
    expect(await h.m.movements.countDocuments({ productRef: 'recv-2', type: 'set_cost' })).toBe(1);
  });

  maybe('a failing line rolls the whole receive back', async () => {
    await customItem('recv-ok', 0);
    const s = await supplier();
    const d = soon(5);
    // The second item has no capacity (unlimited), so adding units to it is refused.
    await h.m.holidays.create({ slug: 'recv-unlimited', title: 'U', country: 'Oman', durationNights: 1, durationDays: 2, published: true });
    const p = await draft(s.id, [
      { itemId: itemId('recv-ok'), quantity: 3, dateFrom: d, dateTo: d, unitCost: 1 },
      { itemId: itemId('recv-unlimited', 'holiday'), quantity: 3, dateFrom: d, dateTo: d, unitCost: 1 },
    ]);
    await expect(h.purchasing.receive(p.id, actor)).rejects.toMatchObject({ response: { code: 'UNLIMITED_ITEM' } });
    expect((await h.purchasing.getPurchase(p.id)).status).toBe('draft');
    expect((await capacityOn('recv-ok', d)).limit).toBe(0);
    expect(await h.m.movements.countDocuments({ productRef: 'recv-ok', type: 'adjust_add' })).toBe(0);
  });

  maybe('void reverses a received purchase cleanly and is idempotent', async () => {
    await customItem('void-1', 2);
    const s = await supplier();
    const d = soon(6);
    const p = await draft(s.id, [{ itemId: itemId('void-1'), quantity: 5, dateFrom: d, dateTo: addDays(d, 1), unitCost: 4 }]);
    await h.purchasing.receive(p.id, actor);
    expect((await capacityOn('void-1', d)).limit).toBe(7);
    const out = await h.purchasing.voidPurchase(p.id, actor);
    expect(out).toMatchObject({ changed: true, purchase: { status: 'void' } });
    expect((await capacityOn('void-1', d)).limit).toBe(2);
    expect((await capacityOn('void-1', addDays(d, 1))).limit).toBe(2);
    expect(await h.m.movements.countDocuments({ productRef: 'void-1', type: 'adjust_remove' })).toBe(2);
    expect((await h.purchasing.voidPurchase(p.id, actor)).changed).toBe(false);
    expect((await capacityOn('void-1', d)).limit).toBe(2);
    await expect(h.purchasing.receive(p.id, actor)).rejects.toMatchObject({ response: { code: 'NOT_RECEIVABLE' } });
  });

  maybe('voiding a draft touches no stock; a paid purchase cannot be voided', async () => {
    await customItem('void-2', 1);
    const s = await supplier();
    const d = soon(6);
    const p = await draft(s.id, [{ itemId: itemId('void-2'), quantity: 5, dateFrom: d, dateTo: d, unitCost: 4 }]);
    expect((await h.purchasing.voidPurchase(p.id, actor)).purchase.status).toBe('void');
    expect(await h.m.movements.countDocuments({ productRef: 'void-2', type: { $in: ['adjust_add', 'adjust_remove'] } })).toBe(0);
    const q = await draft(s.id, [{ itemId: itemId('void-2'), quantity: 5, dateFrom: d, dateTo: d, unitCost: 4 }]);
    await expect(h.purchasing.markPaid(q.id, {})).rejects.toMatchObject({ response: { code: 'NOT_PAYABLE' } });
    await h.purchasing.receive(q.id, actor);
    const paid = await h.purchasing.markPaid(q.id, { reference: 'TT-1', paidAt: '2026-10-11' });
    expect(paid.purchase).toMatchObject({ status: 'paid', paymentReference: 'TT-1' });
    expect((await h.purchasing.markPaid(q.id, {})).changed).toBe(false);
    await expect(h.purchasing.voidPurchase(q.id, actor)).rejects.toMatchObject({ response: { code: 'NOT_VOIDABLE' } });
  });

  maybe('void is refused when the units were already sold, and nothing changes', async () => {
    await holiday('void-sold', 0);
    const s = await supplier();
    const d = soon(8);
    const p = await draft(s.id, [{ itemId: itemId('void-sold', 'holiday'), quantity: 3, dateFrom: d, dateTo: d, unitCost: 50 }]);
    await h.purchasing.receive(p.id, actor);
    await h.enquiries.confirm(confirmDto(await enquiry('void-sold'), d, 2, 300), actor);
    await expect(h.purchasing.voidPurchase(p.id, actor)).rejects.toMatchObject({
      status: 409,
      response: { code: 'STOCK_BELOW_COMMITTED', date: d, committed: 2 },
    });
    expect((await h.purchasing.getPurchase(p.id)).status).toBe('received');
    expect((await capacityOn('void-sold', d, 'holiday')).limit).toBe(3);
  });

  maybe('suppliers: case-insensitive unique names, SUPPLIER_IN_USE on delete', async () => {
    const a = await supplier('Dubai Tickets LLC');
    await expect(h.purchasing.createSupplier({ name: 'dubai tickets llc', country: 'AE' })).rejects.toMatchObject({ response: { code: 'SUPPLIER_EXISTS' } });
    await customItem('sup-del', 1);
    const d = soon(5);
    await draft(a.id, [{ itemId: itemId('sup-del'), quantity: 1, dateFrom: d, dateTo: d, unitCost: 1 }]);
    await expect(h.purchasing.deleteSupplier(a.id)).rejects.toMatchObject({ response: { code: 'SUPPLIER_IN_USE' } });
    const free = await supplier();
    await expect(h.purchasing.deleteSupplier(free.id)).resolves.toBeDefined();
    await expect(h.purchasing.getSupplier(free.id)).rejects.toMatchObject({ response: { code: 'SUPPLIER_NOT_FOUND' } });
  });

  maybe('drafts are editable; received purchases only accept notes', async () => {
    await customItem('edit-1', 1);
    const s = await supplier();
    const d = soon(5);
    const p = await draft(s.id, [{ itemId: itemId('edit-1'), quantity: 1, dateFrom: d, dateTo: d, unitCost: 10 }]);
    const edited = await h.purchasing.updatePurchase(p.id, { lines: [{ itemId: itemId('edit-1'), quantity: 2, dateFrom: d, dateTo: d, unitCost: 10 }], notes: 'n' });
    expect(edited.after).toMatchObject({ total: 20, notes: 'n' });
    await expect(h.purchasing.updatePurchase(p.id, { lines: [{ itemId: 'nope', quantity: 1, dateFrom: d, dateTo: d, unitCost: 1 }] })).rejects.toMatchObject({ response: { code: 'INVALID_ITEM_ID' } });
    await expect(h.purchasing.updatePurchase(p.id, { lines: [{ itemId: itemId('missing'), quantity: 1, dateFrom: d, dateTo: d, unitCost: 1 }] })).rejects.toMatchObject({ response: { code: 'ITEM_NOT_FOUND' } });
    await h.purchasing.receive(p.id, actor);
    await expect(h.purchasing.updatePurchase(p.id, { supplierInvoiceNumber: 'X' })).rejects.toMatchObject({ response: { code: 'NOT_EDITABLE' } });
    expect((await h.purchasing.updatePurchase(p.id, { notes: 'after receipt' })).after.notes).toBe('after receipt');
  });

  maybe('lists, totals and the summary count what was bought', async () => {
    const s = await supplier();
    await customItem('sum-1', 1);
    const d = soon(5);
    const mk = (cost: number, due?: string) => draft(s.id, [{ itemId: itemId('sum-1'), quantity: 1, dateFrom: d, dateTo: d, unitCost: cost }], due ? { dueDate: due } : {});
    const a = await mk(100);
    const b = await mk(50, addDays(today(), -1));
    await h.purchasing.receive(b.id, actor);
    const before = await h.purchasing.summary();
    expect(before.draftCount).toBeGreaterThanOrEqual(1);
    expect(before.overdueCount).toBeGreaterThanOrEqual(1);
    const list = await h.purchasing.listPurchases({ supplierId: s.id, page: 1, limit: 25 });
    expect(list.items.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(list.items[0]).toHaveProperty('totalUnits');
    expect(list.totals).toEqual({ count: 2, total: 150 });
    const received = await h.purchasing.listPurchases({ supplierId: s.id, status: 'received', page: 1, limit: 25 } as never);
    expect(received.totals).toEqual({ count: 1, total: 50 });
    const q = await h.purchasing.listPurchases({ q: b.number, page: 1, limit: 25 });
    expect(q.items).toHaveLength(1);
  });

  maybe('a booking confirmed after a purchase gets the cost snapshot and shows the right margin', async () => {
    await holiday('margin-a', 0);
    await holiday('margin-b', 5);
    const s = await supplier();
    const d = soon(9);
    const p = await draft(s.id, [{ itemId: itemId('margin-a', 'holiday'), quantity: 5, dateFrom: d, dateTo: d, unitCost: 40 }]);
    await h.purchasing.receive(p.id, actor);

    const a = await h.enquiries.confirm(confirmDto(await enquiry('margin-a'), d, 2, 200), actor);
    const b = await h.enquiries.confirm(confirmDto(await enquiry('margin-b'), d, 1, 90), actor);
    const bookingA = (await h.m.bookings.findById(a.booking.id).lean())!;
    const taxA = Math.round((bookingA.taxComponents ?? []).reduce((sum, c) => sum + c.taxAmount, 0) * 100) / 100;
    const revA = Math.round((200 - taxA) * 100) / 100;
    const costA = bookingA.cost;
    expect(costA).toMatchObject({ unitCost: 40, quantity: 2, total: 80, currency: 'AED', source: 'policy' });
    expect((await h.m.bookings.findById(b.booking.id).lean())!.cost).toBeNull();

    const report = await h.reports.marginReport({ range: '7d', groupBy: 'product' });
    const rowA = report.rows.find((r) => r.key === 'holiday:margin-a')!;
    expect(rowA).toMatchObject({ bookings: 1, units: 2, revenueExTax: revA, taxTotal: taxA, cost: 80, margin: Math.round((revA - 80) * 100) / 100, bookingsWithoutCost: 0 });
    expect(taxA).toBeGreaterThan(0);
    expect(rowA.marginPct).toBe(Math.round(((revA - 80) / revA) * 1000) / 10);
    const rowB = report.rows.find((r) => r.key === 'holiday:margin-b')!;
    expect(rowB).toMatchObject({ cost: 0, margin: 0, marginPct: null, bookingsWithoutCost: 1 });
    expect(report.totals.bookingsWithoutCost).toBeGreaterThanOrEqual(1);

    // Supplier filter: only items bought from that supplier.
    const bySupplier = await h.reports.marginReport({ range: '7d', groupBy: 'type', supplierId: s.id });
    expect(bySupplier.rows).toHaveLength(1);
    expect(bySupplier.totals).toMatchObject({ bookings: 1, revenueExTax: revA, cost: 80 });
    const none = await h.reports.marginReport({ range: '7d', supplierId: new mongoose.Types.ObjectId().toString() });
    expect(none.totals.bookings).toBe(0);
    expect((await h.reports.marginReport({ range: '7d', groupBy: 'type', productType: 'activity' })).totals.bookings).toBe(0);

    // A partial refund subtracts proportionally; tax from the snapshot comes out of revenue.
    await h.m.bookings.updateOne({ _id: a.booking.id }, { $set: { refundedAmount: 50, taxComponents: [{ code: 'VAT', label: 'VAT', percent: 5, taxableAmount: 190.48, taxAmount: 9.52 }] } });
    const refunded = await h.reports.marginReport({ range: '7d', groupBy: 'month', supplierId: s.id });
    expect(refunded.rows[0].key).toBe(today().slice(0, 7));
    expect(refunded.totals).toMatchObject({ revenueExTax: 142.86, taxTotal: 7.14, cost: 80, margin: 62.86 });
    expect(refunded.totals.marginPct).toBe(44);
  });
});
