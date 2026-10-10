import mongoose from 'mongoose';
import { BookingsService } from '../bookings/bookings.service';
import { Booking, BookingSchema, BookingStatus } from '../bookings/schemas/booking.schema';
import { Activity, ActivitySchema } from '../catalog/schemas/activity.schema';
import { CapacityLock, CapacityLockSchema } from '../catalog/schemas/capacity-lock.schema';
import { CartSession, CartSessionSchema } from '../checkout/schemas/cart-session.schema';
import { TransactionService } from '../common/database/transaction.service';
import { CruiseEnquiry, CruiseEnquirySchema } from '../cruises/schemas/cruise-enquiry.schema';
import { Cruise, CruiseSchema } from '../cruises/schemas/cruise.schema';
import { EventEnquiry, EventEnquirySchema } from '../events/schemas/event-enquiry.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { HolidayEnquiry, HolidayEnquirySchema } from '../holidays/schemas/holiday-enquiry.schema';
import { Holiday, HolidaySchema } from '../holidays/schemas/holiday.schema';
import { Lead, LeadSchema } from '../leads/lead.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { operatingToday, addDays } from '../catalog/activity-booking.utils';
import { EnquiryBookingService } from './enquiry-booking.service';
import { StockAlertState, StockAlertStateSchema } from './schemas/stock-alert-state.schema';
import { StockDay, StockDaySchema } from './schemas/stock-day.schema';
import { StockMovement, StockMovementSchema } from './schemas/stock-movement.schema';
import { StockPolicy, StockPolicySchema } from './schemas/stock-policy.schema';
import { StockAdminService } from './stock-admin.service';
import { StockService } from './stock.service';
import type { EnquiryBookingDto } from './dto/stock.dto';

/**
 * Runs against a real MongoDB replica set in a throw-away database (dropped afterwards). Skipped when no replica set
 * is reachable, like the transaction integration test.
 */
const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex?replicaSet=rs0';
const dbName = `tourvex_stock_test_${Date.now()}`;

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
  const bookingsService = new BookingsService(m.bookings as never, {} as never, {} as never, {} as never, {} as never);
  jest.spyOn(bookingsService, 'afterConfirmed').mockResolvedValue(undefined);
  const enquiries = new EnquiryBookingService(
    m.holidayEnquiries as never, m.cruiseEnquiries as never, m.eventEnquiries as never, m.users as never, m.leads as never,
    stock, bookingsService, { findInvoiceForBooking: jest.fn().mockResolvedValue({ invoiceNumber: 'INV-1' }) } as never,
    { markWonFromEnquiry: jest.fn().mockResolvedValue(undefined) } as never, notifications as never, transactions,
  );
  const admin = new StockAdminService(stock, transactions, m.bookings as never);
  return { m, stock, enquiries, admin, notifications, cache, transactions };
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
  }, 60_000);

const actor = { id: new mongoose.Types.ObjectId().toString(), email: 'ops@example.com' };
let seq = 0;
const soon = (days = 7) => addDays(operatingToday(new Date()), days);

async function holiday(slug: string, capacity: number | null) {
  await h.m.holidays.create({ slug, title: `Holiday ${slug}`, country: 'Oman', durationNights: 2, durationDays: 3, published: true });
  if (capacity !== null) await h.m.policies.create({ productType: 'holiday', productRef: slug, variantId: 'default', title: `Holiday ${slug}`, defaultCapacity: capacity });
}

async function enquiry(slug: string) {
  seq += 1;
  const doc = await h.m.holidayEnquiries.create({
    holidayId: new mongoose.Types.ObjectId(), holidaySlug: slug, reference: `HOL-T${Date.now()}${seq}`, fullName: `Guest ${seq}`,
    email: `guest${seq}.${Date.now()}@example.com`, phone: '+971500000000', consentAt: new Date(),
  });
  return doc._id.toString();
}

const confirmDto = (slug: string, enquiryId: string, day: string, quantity = 1): EnquiryBookingDto => ({
  source: 'holiday', enquiryId, variantId: 'default', serviceDay: day, quantity, totalAmount: 100 * quantity, currency: 'AED', paymentMode: 'cash',
});

describe('Stock engine against MongoDB', () => {
  maybe('enquiry confirmations never oversell the last units under concurrency', async () => {
    await holiday('race-units', 3);
    const day = soon();
    const ids = await Promise.all(Array.from({ length: 8 }, () => enquiry('race-units')));
    const results = await Promise.all(
      ids.map((id) => h.enquiries.confirm(confirmDto('race-units', id, day), actor).then(() => 'booked', (e: { response?: { code?: string; available?: number } }) => e.response?.code ?? 'ERROR')),
    );
    expect(results.filter((r) => r === 'booked')).toHaveLength(3);
    expect(results.filter((r) => r === 'STOCK_UNAVAILABLE')).toHaveLength(5);
    expect(await h.m.bookings.countDocuments({ stockProductRef: 'race-units', status: BookingStatus.Confirmed })).toBe(3);
    expect(await h.m.holidayEnquiries.countDocuments({ holidaySlug: 'race-units', status: 'booked', bookingReference: { $exists: true } })).toBe(3);
    const info = (await h.stock.capacityInfo({ productType: 'holiday', productRef: 'race-units', variantId: 'default' }, null, day, day, new Date())).get(day)!;
    expect(info).toMatchObject({ sold: 3, available: 0 });
  });

  maybe('multi-unit confirmations: the second group that no longer fits is refused with the units left', async () => {
    await holiday('race-groups', 5);
    const day = soon(8);
    const ids = await Promise.all([enquiry('race-groups'), enquiry('race-groups'), enquiry('race-groups')]);
    const results = await Promise.all(
      ids.map((id) => h.enquiries.confirm(confirmDto('race-groups', id, day, 3), actor).then(() => 'booked', (e: { response?: { code?: string; available?: number } }) => e.response)),
    );
    expect(results.filter((r) => r === 'booked')).toHaveLength(1);
    const failures = results.filter((r) => r !== 'booked') as { code: string; available: number }[];
    expect(failures.map((f) => f.code)).toEqual(['STOCK_UNAVAILABLE', 'STOCK_UNAVAILABLE']);
    expect(failures.every((f) => f.available === 2)).toBe(true);
  });

  maybe('a confirmed enquiry cannot be booked twice, and the booking is confirmed with its stock identity', async () => {
    await holiday('once-only', null);
    const id = await enquiry('once-only');
    const first = await h.enquiries.confirm(confirmDto('once-only', id, soon()), actor);
    expect(first.invoiceNumber).toBe('INV-1');
    expect(first.booking).toMatchObject({ status: 'confirmed', stockProductType: 'holiday', stockProductRef: 'once-only', stockVariantId: 'default' });
    await expect(h.enquiries.confirm(confirmDto('once-only', id, soon()), actor)).rejects.toMatchObject({ response: { code: 'ENQUIRY_ALREADY_BOOKED' } });
    expect(await h.m.movements.countDocuments({ type: 'booking_confirmed', productRef: 'once-only' })).toBe(1);
  });

  maybe('online-style holds: concurrent orders for the last units never oversell, and expired holds free the capacity', async () => {
    await holiday('race-holds', 2);
    const day = soon(9);
    const key = { productType: 'holiday' as const, productRef: 'race-holds', variantId: 'default' };
    await h.stock.ensureLocks([{ ...key, day }]);
    const order = (n: number) =>
      h.transactions
        .run(async (session) => {
          await h.stock.lock([{ ...key, day }], session);
          const info = (await h.stock.capacityInfo(key, null, day, day, new Date(), { session })).get(day)!;
          if (info.limit !== null && info.limit - info.booked < 1) throw new Error('DATE_UNAVAILABLE');
          await h.m.bookings.create(
            [{
              reference: `TVX-2030-HOLD${n}`, customerId: new mongoose.Types.ObjectId(), serviceType: 'holiday', title: 'x', quantity: 1, unitPrice: 1, subtotal: 1, total: 1,
              currency: 'AED', status: BookingStatus.PendingPayment, holdExpiresAt: new Date(Date.now() + 600_000), serviceDay: day,
              stockProductType: 'holiday', stockProductRef: 'race-holds', stockVariantId: 'default',
            }],
            { session },
          );
          return 'held';
        })
        .catch((e: Error) => e.message);
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(order));
    expect(results.filter((r) => r === 'held')).toHaveLength(2);
    const now = new Date();
    expect((await h.stock.capacityInfo(key, null, day, day, now)).get(day)).toMatchObject({ held: 2, available: 0 });
    // Holds that ran out stop counting immediately.
    expect((await h.stock.capacityInfo(key, null, day, day, new Date(Date.now() + 11 * 60_000))).get(day)).toMatchObject({ held: 0, available: 2 });
    await h.m.bookings.updateMany({ stockProductRef: 'race-holds' }, { $set: { status: BookingStatus.Expired }, $unset: { holdExpiresAt: 1 } });
    expect((await h.stock.capacityInfo(key, null, day, day, now)).get(day)).toMatchObject({ held: 0, available: 2 });
  });

  maybe('cancelling before the cutoff returns the units; after the cutoff they stay used until staff return them', async () => {
    await holiday('cancel-rules', 10);
    const key = { productType: 'holiday' as const, productRef: 'cancel-rules', variantId: 'default' };
    const far = soon(10);
    const near = operatingToday(new Date()); // service today: the 24h cutoff has passed
    const make = async (ref: string, day: string, qty: number) => {
      const doc = await h.m.bookings.create({
        reference: ref, customerId: new mongoose.Types.ObjectId(), serviceType: 'holiday', title: 'Cancel rules', quantity: qty, unitPrice: 1, subtotal: 1, total: 1,
        currency: 'AED', status: BookingStatus.Confirmed, confirmedAt: new Date(), serviceDay: day,
        stockProductType: 'holiday', stockProductRef: 'cancel-rules', stockVariantId: 'default',
      });
      return doc.toObject();
    };
    const usedOn = async (day: string) => (await h.stock.capacityInfo(key, null, day, day, new Date())).get(day)!.booked;

    const early = await make('TVX-2030-EARLY001', far, 4);
    const late = await make('TVX-2030-LATE0001', near, 3);
    expect(await usedOn(far)).toBe(4);
    expect(await usedOn(near)).toBe(3);

    for (const [booking, expectRestock] of [[early, true], [late, false]] as const) {
      const plan = await h.stock.cancellationPlan(booking);
      expect(plan?.stockReleased).toBe(expectRestock);
      await h.m.bookings.updateOne({ _id: booking._id }, { $set: { status: BookingStatus.Cancelled, stockReleased: plan!.stockReleased } });
      await h.stock.afterCancellation(booking, plan!, actor);
      // The same webhook / click again writes nothing twice.
      await h.stock.afterCancellation(booking, plan!, actor);
    }
    expect(await usedOn(far)).toBe(0);
    expect(await usedOn(near)).toBe(3);
    expect(await h.m.movements.countDocuments({ productRef: 'cancel-rules', type: 'restock_auto' })).toBe(1);
    expect(await h.m.movements.countDocuments({ productRef: 'cancel-rules', type: 'booking_cancelled' })).toBe(2);

    await expect(h.admin.returnToStock('TVX-2030-EARLY001', 'x', actor)).rejects.toMatchObject({ response: { code: 'ALREADY_RETURNED' } });
    const returned = await h.admin.returnToStock('TVX-2030-LATE0001', 'Customer rebooked', actor);
    expect(returned.returned).toBe(3);
    expect(await usedOn(near)).toBe(0);
    await expect(h.admin.returnToStock('TVX-2030-LATE0001', 'again', actor)).rejects.toMatchObject({ response: { code: 'ALREADY_RETURNED' } });
    await h.m.bookings.create({
      reference: 'TVX-2030-CONF0001', customerId: new mongoose.Types.ObjectId(), serviceType: 'holiday', title: 'c', quantity: 1, unitPrice: 1, subtotal: 1, total: 1,
      currency: 'AED', status: BookingStatus.Confirmed, serviceDay: far, stockProductType: 'holiday', stockProductRef: 'cancel-rules', stockVariantId: 'default',
    });
    await expect(h.admin.returnToStock('TVX-2030-CONF0001', 'x', actor)).rejects.toMatchObject({ response: { code: 'NOT_RETURNABLE' } });
    expect(await h.m.movements.countDocuments({ productRef: 'cancel-rules', type: 'restock_manual' })).toBe(1);
  });

  maybe('admin edits: lowering capacity below committed units is refused, overrides win, ledger rows are written', async () => {
    await holiday('admin-edits', 10);
    const id = 'holiday:admin-edits:default';
    const day = soon(5);
    await h.m.bookings.create({
      reference: 'TVX-2030-ADMIN001', customerId: new mongoose.Types.ObjectId(), serviceType: 'holiday', title: 'a', quantity: 6, unitPrice: 1, subtotal: 1, total: 1,
      currency: 'AED', status: BookingStatus.Confirmed, serviceDay: day, stockProductType: 'holiday', stockProductRef: 'admin-edits', stockVariantId: 'default',
    });
    await expect(h.admin.updateItem(id, { defaultCapacity: 4 }, actor)).rejects.toMatchObject({ response: { code: 'STOCK_BELOW_COMMITTED', date: day, committed: 6 } });
    await expect(
      h.admin.updateDays(id, { from: day, to: day, mode: 'remove', capacity: 8, reason: 'x' }, actor),
    ).rejects.toMatchObject({ response: { code: 'STOCK_BELOW_COMMITTED', date: day, committed: 6 } });
    // An override above the committed units covers the date, so the default can come down.
    await h.admin.updateDays(id, { from: day, to: day, mode: 'set', capacity: 8 }, actor);
    const patched = await h.admin.updateItem(id, { defaultCapacity: 4 }, actor);
    expect(patched.after.defaultCapacity).toBe(4);
    const view = await h.admin.getItem(id, { from: day, to: day });
    expect(view.days[0]).toMatchObject({ capacity: 8, capacitySource: 'override', sold: 6, available: 2, status: 'low' });
    const closed = await h.admin.updateDays(id, { from: day, to: day, mode: 'set', closed: true }, actor);
    expect(closed.days[0]).toMatchObject({ status: 'closed', capacity: 8 });
    // Clearing would drop the date to the default of 4, below the 6 committed units.
    await expect(h.admin.updateDays(id, { from: day, to: day, mode: 'clear' }, actor)).rejects.toMatchObject({ response: { code: 'STOCK_BELOW_COMMITTED', committed: 6 } });
    const other = addDays(day, 1);
    await h.admin.updateDays(id, { from: other, to: other, mode: 'set', capacity: 3, closed: true, note: 'private event' }, actor);
    const cleared = await h.admin.updateDays(id, { from: other, to: other, mode: 'clear' }, actor);
    expect(cleared.days[0]).toMatchObject({ capacitySource: 'default', closed: false, note: '' });
    expect(await h.m.days.countDocuments({ productRef: 'admin-edits' })).toBe(1);
    const types = (await h.m.movements.find({ productRef: 'admin-edits' }).lean()).map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(['set_default', 'set_day', 'close', 'open']));
    const list = await h.admin.listItems({ type: 'holiday', q: 'admin-edits', page: 1, limit: 20 });
    expect(list.items[0]).toMatchObject({ id, hasPolicy: true, defaultCapacity: 4 });
  });

  maybe('manual items: unique, alerted once per state until recovery, public flags and caches follow stock', async () => {
    const created = await h.admin.createItem({ productType: 'yacht', productRef: 'sunset-yacht', title: 'Sunset yacht', defaultCapacity: 5 }, actor);
    expect(created).toMatchObject({ id: 'yacht:sunset-yacht:default', status: 'low', hasPolicy: true });
    await expect(h.admin.createItem({ productType: 'yacht', productRef: 'sunset-yacht', title: 'x', defaultCapacity: 1 }, actor)).rejects.toMatchObject({ response: { code: 'ITEM_EXISTS' } });

    const emails = () => h.notifications.stockAlert.mock.calls.length;
    expect(emails()).toBeGreaterThanOrEqual(1);
    const lowRows = () => h.m.movements.countDocuments({ productRef: 'sunset-yacht', type: 'alert_low' });
    const firstRows = await lowRows();
    expect(firstRows).toBeGreaterThan(0);
    expect(h.notifications.stockAlert.mock.calls.at(-1)![0]).toMatchObject({ recipients: ['ops@example.com'] });

    // Sweeps and repeated refreshes do not alert again (the first sweep may alert about items of earlier tests).
    await h.stock.sweep();
    const before = emails();
    const firstRowsAfterSweep = await lowRows();
    await h.stock.sweep();
    await h.stock.sweep();
    expect(emails()).toBe(before);
    expect(await lowRows()).toBe(firstRowsAfterSweep);

    // Recovery forgets the alert state; running low again alerts again.
    await h.admin.updateItem('yacht:sunset-yacht:default', { defaultCapacity: 500 }, actor);
    expect(await h.m.alerts.countDocuments({ productRef: 'sunset-yacht' })).toBe(0);
    await h.admin.updateItem('yacht:sunset-yacht:default', { defaultCapacity: 5 }, actor);
    expect(emails()).toBe(before + 1);
    expect(await lowRows()).toBe(firstRowsAfterSweep * 2);

    const summary = await h.admin.summary();
    expect(summary.lowStock).toBeGreaterThanOrEqual(1);
    expect(summary.attention.length).toBeLessThanOrEqual(8);
  });

  maybe('sold-out products get stockStatus.soldOut (and the caches are invalidated); stock coming back clears it', async () => {
    await holiday('flag-holiday', 1);
    await h.m.holidays.updateOne({ slug: 'flag-holiday' }, { $set: { stockStatus: undefined } });
    h.cache.invalidate.mockClear();
    await h.stock.refreshProducts([{ productType: 'holiday', productRef: 'flag-holiday' }]);
    let doc = await h.m.holidays.findOne({ slug: 'flag-holiday' }).lean();
    expect(doc?.stockStatus).toMatchObject({ soldOut: false });

    // Capacity 1 on every day; sell every day of the horizon by closing the item.
    await h.admin.updateItem('holiday:flag-holiday:default', { stopSale: true }, actor);
    doc = await h.m.holidays.findOne({ slug: 'flag-holiday' }).lean();
    expect(doc?.stockStatus).toMatchObject({ soldOut: true, nextAvailableDate: null });
    expect(h.cache.invalidate).toHaveBeenCalledWith('holidays');

    await h.admin.updateItem('holiday:flag-holiday:default', { stopSale: false }, actor);
    doc = await h.m.holidays.findOne({ slug: 'flag-holiday' }).lean();
    expect(doc?.stockStatus).toMatchObject({ soldOut: false, lowStock: true, lowestRemaining: 1 });
  });
});
