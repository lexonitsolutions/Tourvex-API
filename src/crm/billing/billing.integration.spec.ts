import mongoose, { Types } from 'mongoose';
import { Booking, BookingSchema } from '../../bookings/schemas/booking.schema';
import { TransactionService } from '../../common/database/transaction.service';
import { Cruise, CruiseSchema } from '../../cruises/schemas/cruise.schema';
import { Event, EventSchema } from '../../events/schemas/event.schema';
import { Holiday, HolidaySchema } from '../../holidays/schemas/holiday.schema';
import { SellerRegistration, SellerRegistrationSchema } from '../../tax/schemas/seller-registration.schema';
import { TaxRegime, TaxRegimeSchema } from '../../tax/schemas/tax-regime.schema';
import { TaxSetting, TaxSettingSchema } from '../../tax/schemas/tax-setting.schema';
import { DEFAULT_REGIMES } from '../../tax/tax.defaults';
import { bookingTaxFields } from '../../tax/tax-snapshot';
import { exclusiveBreakdown, toMinor } from '../../tax/tax.rules';
import { TaxService } from '../../tax/tax.service';
import { BillingService, type InvoiceSource } from './billing.service';
import { operatingYear } from './invoice-rules';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';

/**
 * Runs against a real MongoDB replica set in a throw-away database (dropped afterwards). Skipped when no replica set
 * is reachable, like the stock integration test.
 */
const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex?replicaSet=rs0';
const dbName = `tourvex_billing_test_${Date.now()}`;

let connection: mongoose.Connection | undefined;
let available = false;
let h: ReturnType<typeof build>;

const sendInvoiceEmail = jest.fn();
const notifications = { emailEnabled: false, sendInvoiceEmail };

function build(conn: mongoose.Connection) {
  const m = {
    invoices: conn.model(Invoice.name, InvoiceSchema),
    counters: conn.model(Counter.name, CounterSchema),
    regimes: conn.model(TaxRegime.name, TaxRegimeSchema),
    sellers: conn.model(SellerRegistration.name, SellerRegistrationSchema),
    taxSettings: conn.model(TaxSetting.name, TaxSettingSchema),
    holidays: conn.model(Holiday.name, HolidaySchema),
    cruises: conn.model(Cruise.name, CruiseSchema),
    events: conn.model(Event.name, EventSchema),
    bookings: conn.model(Booking.name, BookingSchema),
  };
  const tax = new TaxService(
    m.regimes as never, m.sellers as never, m.taxSettings as never, m.holidays as never, m.cruises as never, m.events as never,
    { getCommerce: jest.fn().mockResolvedValue({ taxPercent: 5 }) } as never,
  );
  const settings = { get: jest.fn().mockResolvedValue({ legalName: 'Legacy Co', siteName: 'Site', supportEmail: 'help@example.com' }) };
  const billing = new BillingService(m.invoices as never, m.counters as never, settings as never, tax, notifications as never, new TransactionService(conn));
  return { m, tax, billing };
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
    await h.m.regimes.insertMany(DEFAULT_REGIMES);
    const legacy = new Types.ObjectId();
    const india = new Types.ObjectId();
    await h.m.sellers.insertMany([
      { _id: legacy, country: 'AE', legalName: 'Karnish Tourism LLC', registrationNumber: '100123456700003', address: 'Dubai', email: 'help@example.com', phone: '1', website: '', isDefault: true, active: true, numberingScope: 'legacy' },
      { _id: india, country: 'IN', legalName: 'Karnish India Pvt Ltd', registrationNumber: '32AABCK1234F1Z5', address: 'Kochi', state: 'Kerala', stateCode: '32', email: '', phone: '', website: '', isDefault: false, active: true, numberingScope: india.toString() },
    ]);
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

const year = operatingYear(new Date());
const seq = (n: number) => String(n).padStart(6, '0');

async function booking(country: 'AE' | 'IN', rateCode?: string, netMinor = 9_999, over: Partial<InvoiceSource> = {}): Promise<InvoiceSource> {
  const det = await h.tax.determine({ serviceCountry: country, ...(rateCode && { override: { rateCode } }) });
  const breakdown = exclusiveBreakdown(netMinor, det);
  return {
    _id: new Types.ObjectId(),
    reference: `TVX-${new Types.ObjectId().toString().slice(-8)}`,
    customerId: new Types.ObjectId(),
    customer: { fullName: 'Ada Lovelace', email: 'ada@example.com', phoneCountryCode: '+44', phone: '7000' },
    title: 'Tour',
    quantity: 1,
    unitPrice: netMinor / 100,
    subtotal: netMinor / 100,
    discount: 0,
    tax: breakdown.taxMinor / 100,
    total: breakdown.totalMinor / 100,
    currency: country === 'IN' ? 'INR' : 'AED',
    paymentReference: 'pi_test',
    ...bookingTaxFields(det, breakdown.netMinor, breakdown.taxMinor),
    ...over,
  };
}

const numbersOf = (docs: { invoiceNumber: string }[]) => docs.map((d) => d.invoiceNumber).sort();

describe('invoice numbering and credit notes against MongoDB', () => {
  maybe('20 concurrent UAE invoices get unique, gap-free numbers on the legacy counter', async () => {
    const bookings = await Promise.all(Array.from({ length: 20 }, () => booking('AE')));
    const docs = await Promise.all(bookings.map((b) => h.billing.createForBooking(b)));
    expect(numbersOf(docs)).toEqual(Array.from({ length: 20 }, (_, i) => `INV-${year}-${seq(i + 1)}`));
    expect(docs[0].taxInfo?.country).toBe('AE');
    expect(docs[0].seller?.registrationNumber).toBe('100123456700003');
    expect((await h.m.counters.findById(`inv-${year}`).lean())!.seq).toBe(20);
  });

  maybe('20 concurrent India invoices use their own series, stay within 16 characters and have no gaps', async () => {
    const bookings = await Promise.all(Array.from({ length: 20 }, () => booking('IN', 'gst18')));
    const docs = await Promise.all(bookings.map((b) => h.billing.createForBooking(b)));
    const yy = String(year).slice(-2);
    expect(numbersOf(docs)).toEqual(Array.from({ length: 20 }, (_, i) => `INV-IN${yy}-${seq(i + 1)}`));
    for (const doc of docs) {
      expect(doc.invoiceNumber.length).toBeLessThanOrEqual(16);
      expect(doc.seller?.sellerId).toBeTruthy();
      expect(doc.taxInfo?.components.map((c) => c.code)).toEqual(['CGST', 'SGST']);
      expect(doc.title).toBe('Tax Invoice');
    }
    // The UAE series was not touched.
    expect((await h.m.counters.findById(`inv-${year}`).lean())!.seq).toBe(20);
  });

  maybe('repeating or racing the same booking creates one invoice and burns no number', async () => {
    const same = await booking('AE');
    const results = await Promise.all(Array.from({ length: 6 }, () => h.billing.createForBooking(same)));
    expect(new Set(results.map((r) => r._id.toString())).size).toBe(1);
    expect(await h.m.invoices.countDocuments({ bookingId: same._id })).toBe(1);
    const next = await h.billing.createForBooking(await booking('AE'));
    expect(Number(next.invoiceNumber.split('-')[2])).toBe(Number(results[0].invoiceNumber.split('-')[2]) + 1);
  });

  maybe('credit notes of several partial refunds add up exactly to the India invoice, per component', async () => {
    const source = await booking('IN', 'gst18', 9_999);
    const invoice = await h.billing.createForBooking(source);
    const totalMinor = toMinor(source.total);
    const cuts = [3_000, 3_333, 4_000, totalMinor - 10_333];
    let refunded = 0;
    const notes: Awaited<ReturnType<typeof h.billing.createCreditNote>>[] = [];
    for (const refundMinor of cuts) {
      notes.push(await h.billing.createCreditNote({ booking: source, refundId: new Types.ObjectId(), refundMinor, alreadyRefundedMinor: refunded, reason: 'Cancelled' }));
      refunded += refundMinor;
    }
    expect(notes.every((n) => /^CN-IN\d\d-\d{6}$/.test(n.invoiceNumber))).toBe(true);
    const sumMinor = (pick: (n: (typeof notes)[number]) => number) => notes.reduce((s, n) => s + toMinor(pick(n)), 0);
    expect(sumMinor((n) => n.total)).toBe(totalMinor);
    expect(sumMinor((n) => n.tax)).toBe(toMinor(source.tax));
    expect(sumMinor((n) => n.subtotal)).toBe(totalMinor - toMinor(source.tax));
    for (const code of ['CGST', 'SGST']) {
      const invoiceTax = invoice.taxInfo!.components.find((c) => c.code === code)!.taxAmount;
      expect(sumMinor((n) => n.taxInfo!.components.find((c) => c.code === code)!.taxAmount)).toBe(toMinor(invoiceTax));
    }
    expect((await h.m.invoices.findById(invoice._id).lean())!.status).toBe('refunded');
    // Idempotent per refund.
    const again = await h.billing.createCreditNote({ booking: source, refundId: notes[0].refundId!, refundMinor: cuts[0], alreadyRefundedMinor: 0, reason: 'Cancelled' });
    expect(again._id.toString()).toBe(notes[0]._id.toString());
  });

  maybe('concurrent credit notes are numbered gap-free too', async () => {
    const sources = await Promise.all(Array.from({ length: 10 }, () => booking('AE')));
    const invoices = await Promise.all(sources.map((s) => h.billing.createForBooking(s)));
    expect(invoices).toHaveLength(10);
    const notes = await Promise.all(
      sources.map((s) => h.billing.createCreditNote({ booking: s, refundId: new Types.ObjectId(), refundMinor: toMinor(s.total), alreadyRefundedMinor: 0, reason: 'x' })),
    );
    const numbers = notes.map((n) => Number(n.invoiceNumber.split('-')[2])).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(notes[0].invoiceNumber).toMatch(new RegExp(`^CN-${year}-`));
  });

  maybe('a legacy booking without a tax snapshot still gets a valid invoice', async () => {
    const legacy = await booking('AE');
    for (const key of ['taxCountry', 'taxRegimeId', 'taxName', 'taxModel', 'taxRateCode', 'taxPercent', 'taxComponents', 'taxPricesIncluded', 'taxPlaceOfSupply', 'taxSellerId', 'taxFallback'] as const) {
      delete (legacy as unknown as Record<string, unknown>)[key];
    }
    const doc = await h.billing.createForBooking(legacy);
    expect(doc.taxInfo?.country).toBe('AE');
    expect(doc.taxInfo!.components.reduce((s, c) => s + toMinor(c.taxAmount), 0)).toBe(toMinor(legacy.tax));
    expect((await h.billing.pdfFor(doc.toObject() as never)).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('invoice e-mail tracking against MongoDB', () => {
  beforeEach(() => {
    sendInvoiceEmail.mockReset();
    // Documents are created with e-mail off (status stays pending, no background send); each test turns it on.
    notifications.emailEnabled = false;
    sendInvoiceEmail.mockResolvedValue({ messageId: '<default@test>' });
  });

  maybe('records sent, failed with backoff, then succeeds on the sweep; never exceeds 5 attempts', async () => {
    const invoice = await h.billing.createForBooking(await booking('AE'));
    const id = invoice._id.toString();
    expect(invoice.email).toMatchObject({ status: 'pending', attempts: 0, to: 'ada@example.com' });
    notifications.emailEnabled = true;
    // Only this document takes part in the sweep below.
    await h.m.invoices.updateMany({ _id: { $ne: id } }, { $set: { 'email.status': 'skipped' } });

    sendInvoiceEmail.mockRejectedValueOnce(new Error('550 ada@example.com rejected'));
    const failed = await h.billing.deliverEmail(id, { manual: false });
    expect(failed).toMatchObject({ sent: false, status: 'failed', attempts: 1, to: 'ada@example.com' });
    const stored = (await h.m.invoices.findById(id).lean())!;
    expect(stored.email?.lastError).toBe('550 [address] rejected');
    expect(stored.email?.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // Not yet due: the sweep leaves it alone. After the backoff it sends.
    expect(await h.billing.retryEmails()).toBe(0);
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    sendInvoiceEmail.mockResolvedValueOnce({ messageId: '<m1@test>' });
    expect(await h.billing.retryEmails(new Date(Date.now() + 10 * 60_000))).toBeGreaterThanOrEqual(1);
    const sent = (await h.m.invoices.findById(id).lean())!;
    expect(sent.email).toMatchObject({ status: 'sent', attempts: 2, messageId: '<m1@test>' });
    expect(sent.email?.lastError).toBeUndefined();
    const call = sendInvoiceEmail.mock.calls.at(-1)![0] as { pdf: { filename: string; content: Buffer } };
    expect(call.pdf.filename).toBe(`${invoice.invoiceNumber}.pdf`);
    expect(call.pdf.content.subarray(0, 5).toString()).toBe('%PDF-');

    // A sent document is not sent again automatically, but staff can resend it.
    expect((await h.billing.deliverEmail(id, { manual: false })).status).toBe('sent');
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(2);
    sendInvoiceEmail.mockResolvedValueOnce({ messageId: '<m2@test>' });
    expect(await h.billing.emailInvoice(id, 'other@example.com')).toMatchObject({ sent: true, to: 'other@example.com' });
  });

  maybe('stops retrying after 5 failed attempts', async () => {
    const invoice = await h.billing.createForBooking(await booking('AE'));
    const id = invoice._id.toString();
    notifications.emailEnabled = true;
    sendInvoiceEmail.mockRejectedValue(new Error('down'));
    let at = Date.now();
    for (let i = 0; i < 8; i++) {
      at += 24 * 3_600_000;
      await h.billing.deliverEmail(id, { manual: false }, new Date(at));
    }
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(5);
    expect((await h.m.invoices.findById(id).lean())!.email).toMatchObject({ status: 'failed', attempts: 5 });
  });

  maybe('answers 409 EMAIL_NOT_CONFIGURED to a manual send without SMTP and keeps the status pending', async () => {
    const invoice = await h.billing.createForBooking(await booking('AE'));
    const id = invoice._id.toString();
    await expect(h.billing.emailInvoice(id)).rejects.toMatchObject({ status: 409, response: { code: 'EMAIL_NOT_CONFIGURED' } });
    expect((await h.m.invoices.findById(id).lean())!.email?.status).toBe('pending');
    expect(await h.billing.retryEmails()).toBe(0);
  });

  maybe('skips a document with no recipient', async () => {
    const noEmail = await booking('AE', undefined, 5_000, { customer: { fullName: 'No Mail', email: '' } });
    const invoice = await h.billing.createForBooking(noEmail);
    expect(invoice.email?.status).toBe('skipped');
    notifications.emailEnabled = true;
    await expect(h.billing.emailInvoice(invoice._id.toString())).rejects.toMatchObject({ response: { code: 'NO_RECIPIENT' } });
  });
});
