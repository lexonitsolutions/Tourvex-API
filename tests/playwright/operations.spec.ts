import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { type ClerkClient, createClerkClient } from '@clerk/backend';
import mongoose from 'mongoose';

const ACTIVITY = 'dhow-cruise-dubai-marina';
const OPERATIONS_ROUTES = [
  ['get', 'admin/bookings'],
  ['get', 'admin/bookings/summary'],
  ['get', 'admin/bookings/cancellation-requests'],
  ['get', 'admin/bookings/orders'],
  ['get', 'admin/bookings/export.csv'],
  ['post', 'admin/bookings/665f1c2b9a1e4b0012345678/cancel'],
  ['post', 'admin/bookings/665f1c2b9a1e4b0012345678/refund'],
  ['get', 'admin/vouchers'],
  ['post', 'admin/vouchers/validate'],
  ['post', 'admin/vouchers/665f1c2b9a1e4b0012345678/redeem'],
  ['post', 'admin/vouchers/665f1c2b9a1e4b0012345678/void'],
  ['get', 'admin/finance/overview'],
  ['get', 'admin/finance/reconciliation'],
  ['get', 'admin/invoices'],
  ['get', 'admin/invoices/665f1c2b9a1e4b0012345678/pdf'],
] as const;

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = resolve(process.cwd(), '.env');
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8'))[name] : undefined;
}

const secretKey = envValue('CLERK_SECRET_KEY')?.startsWith('sk_test_') ? envValue('CLERK_SECRET_KEY') : undefined;

test.describe('operations (anonymous)', () => {
  test('every operations route answers 401 without a token', async ({ request }) => {
    for (const [method, path] of OPERATIONS_ROUTES) {
      const response = await request[method](path, { data: method === 'get' ? undefined : {} });
      expect(response.status(), `${method} ${path}`).toBe(401);
    }
    expect((await request.get('bookings')).status()).toBe(401);
    expect((await request.get('bookings/665f1c2b9a1e4b0012345678/invoice.pdf')).status()).toBe(401);
  });

  test('the public voucher lookup is public, throttled and reveals nothing for unknown codes', async ({ request }) => {
    const unknown = await request.get('vouchers/AAAAAAAAAAAAAAAA');
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).code).toBe('VOUCHER_NOT_FOUND');
    expect((await request.get('vouchers/not-a-code')).status()).toBe(404);
  });
});

test.describe('operations (Clerk-authenticated)', () => {
  test.skip(!secretKey, 'CLERK_SECRET_KEY for a Clerk development instance (sk_test_...) is not set');
  test.describe.configure({ mode: 'serial' });

  const mongoUri = envValue('MONGODB_URI') ?? 'mongodb://127.0.0.1:27017/tourvex_test';
  const stamp = Date.now();
  const roles = ['customer', 'owner', 'ops', 'finance', 'support', 'other'] as const;
  type Who = (typeof roles)[number];
  const emails = Object.fromEntries(roles.map((who) => [who, `ops-${who}-${stamp}+clerk_test@example.com`])) as Record<Who, string>;
  const staffRoles: Partial<Record<Who, string[]>> = {
    owner: ['super_admin'],
    ops: ['operations'],
    finance: ['finance'],
    support: ['support'],
  };
  const clerkIds: string[] = [];
  const sessions: Partial<Record<Who, string>> = {};
  const ids: Partial<Record<Who, string>> = {};
  let clerk: ClerkClient;
  let connection: mongoose.Connection;
  let usable = true;

  const auth = async (who: Who) => {
    // The Clerk dev API occasionally drops a connection; retry instead of failing the whole serial run.
    for (let attempt = 1; ; attempt++) {
      try {
        const { jwt } = await clerk.sessions.getToken(sessions[who]!);
        return { Authorization: `Bearer ${jwt}` };
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 500 * attempt));
      }
    }
  };

  test.beforeAll(async () => {
    clerk = createClerkClient({ secretKey });
    connection = await mongoose.createConnection(mongoUri).asPromise();
    const users = connection.collection('users');
    for (const who of roles) {
      const inserted = await users.insertOne({
        firstName: 'Ops',
        lastName: `Tester ${who}`,
        email: emails[who],
        roles: ['customer', ...(staffRoles[who] ?? [])],
        status: 'active',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      ids[who] = inserted.insertedId.toString();
      const user = await clerk.users.createUser({
        emailAddress: [emails[who]],
        username: `ops_test_${randomBytes(6).toString('hex')}`,
        password: `${randomBytes(18).toString('base64url')}-Aa1!`,
        firstName: 'Ops',
        lastName: `Tester ${who}`,
        skipPasswordChecks: true,
      });
      clerkIds.push(user.id);
      sessions[who] = (await clerk.sessions.createSession({ userId: user.id })).id;
    }
  });

  test.afterAll(async () => {
    for (const id of clerkIds) await clerk.users.deleteUser(id).catch(() => undefined);
    if (!connection) return;
    const userIds = Object.values(ids).map((id) => new mongoose.Types.ObjectId(id));
    const bookings = await connection.collection('bookings').find({ customerId: { $in: userIds } }, { projection: { _id: 1, reference: 1 } }).toArray();
    const bookingIds = bookings.map((b) => b._id);
    await connection.collection('vouchers').deleteMany({ bookingId: { $in: bookingIds } });
    await connection.collection('refunds').deleteMany({ bookingId: { $in: bookingIds } });
    await connection.collection('invoices').deleteMany({ bookingId: { $in: bookingIds } });
    await connection.collection('bookings').deleteMany({ _id: { $in: bookingIds } });
    await connection.collection('orders').deleteMany({ userId: { $in: userIds } });
    await connection.collection('checkout_carts').deleteMany({ userId: { $in: userIds } });
    await connection.collection('audit_logs').deleteMany({ actorId: { $in: userIds } });
    await connection.collection('users').deleteMany({ email: { $in: Object.values(emails) } });
    await connection.close();
  });

  test.beforeEach(async ({ request }) => {
    const me = await request.get('admin/me', { headers: await auth('owner') });
    usable = me.status() === 200;
    test.skip(!usable, 'The API under test enforces azp or uses another database than MONGODB_URI (run it with NODE_ENV=test, CLERK_AUTHORIZED_PARTIES=* and the same database)');
  });

  interface Option { id: string; pickupRequired: boolean; childPrice: unknown; minPax: number; maxPax: number }

  async function purchase(request: APIRequestContext, dayIndex: number) {
    const detail = await (await request.get(`catalog/activities/${ACTIVITY}`)).json();
    const option: Option | undefined = detail.options?.find((o: Option) => o.minPax <= 2 && o.maxPax >= 2);
    test.skip(!option, 'No seeded activity option (run npm run seed:activity-details)');
    const dates: string[] = [];
    for (const offset of [0, 1]) {
      const now = new Date();
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
      const body = await (await request.get(`catalog/activities/${ACTIVITY}/availability?optionId=${option!.id}&month=${month}`)).json();
      for (const day of body.days) if (day.status === 'available') dates.push(day.date);
    }
    const headers = await auth('customer');
    const added = await request.post('checkout/cart/items', { headers, data: { activitySlug: ACTIVITY, optionId: option!.id, date: dates[dayIndex], adults: 2, children: 0 } });
    expect(added.status()).toBe(201);
    const cart = await added.json();
    const itemId = cart.items[0].id;
    if (option!.pickupRequired) {
      await request.patch(`checkout/cart/items/${itemId}/pickup`, { headers, data: { mode: 'now', locationName: 'Hotel Sample', address: 'Marina, Dubai' } });
    }
    await request.patch(`checkout/cart/items/${itemId}/additional`, { headers, data: {} });
    await request.patch('checkout/cart/customer', {
      headers,
      data: { fullName: 'Ops Customer', email: emails.customer, phoneCountryCode: '+971', phone: '501234567', nationality: 'India', marketingOptOut: true },
    });
    const paid = await (await request.post('checkout/cart/pay', { headers })).json();
    expect(paid.mode).toBe('mock');
    return { reference: paid.bookingReference as string, orderReference: paid.orderReference as string, dates };
  }

  let a: { reference: string; orderReference: string; dates: string[] };
  let bookingId: string;
  let voucherCode: string;
  let voucherId: string;

  test('a customer gets 403 and staff without the permission get 403', async ({ request }) => {
    for (const [method, path] of OPERATIONS_ROUTES) {
      const response = await request[method](path, { data: method === 'get' ? undefined : {}, headers: await auth('customer') });
      expect(response.status(), `${method} ${path} as customer`).toBe(403);
    }
    // support may read bookings but not vouchers' write side or finance.
    expect((await request.get('admin/bookings', { headers: await auth('support') })).status()).toBe(200);
    expect((await request.get('admin/finance/overview', { headers: await auth('support') })).status()).toBe(403);
    expect((await request.get('admin/invoices', { headers: await auth('ops') })).status()).toBe(403);
    expect((await request.get('admin/finance/overview', { headers: await auth('ops') })).status()).toBe(403);
    expect((await request.get('admin/bookings/export.csv', { headers: await auth('support') })).status()).toBe(403);
  });

  test('a mock checkout confirms the booking, issues a voucher and an invoice', async ({ request }) => {
    a = await purchase(request, 0);
    expect(a.reference).toMatch(/^TVX-\d{4}-[A-F0-9]{8}$/);
    const voucher = await request.get(`bookings/${a.reference}/voucher`, { headers: await auth('customer') });
    expect(voucher.status()).toBe(200);
    const body = await voucher.json();
    expect(body.code).toMatch(/^[A-Z2-7]{16}$/);
    expect(body.url).toMatch(new RegExp(`/v/${body.code}$`));
    expect(body.qr.size).toBeGreaterThan(20);
    expect(body.status).toBe('issued');
    voucherCode = body.code;
    // The QR carries only the random code: no booking reference, name or e-mail in it.
    expect(body.url).not.toContain(a.reference);
    const pdf = await request.get(`bookings/${a.reference}/invoice.pdf`, { headers: await auth('customer') });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    // Another user cannot read it.
    expect((await request.get(`bookings/${a.reference}/voucher`, { headers: await auth('other') })).status()).toBe(404);
    expect((await request.get(`bookings/${a.reference}/invoice.pdf`, { headers: await auth('other') })).status()).toBe(404);
  });

  test('GET /bookings is scoped to the caller even for staff', async ({ request }) => {
    const mine = await (await request.get('bookings', { headers: await auth('customer') })).json();
    expect(mine.map((b: { reference: string }) => b.reference)).toContain(a.reference);
    for (const who of ['owner', 'ops', 'finance'] as const) {
      const list = await (await request.get('bookings', { headers: await auth(who) })).json();
      expect(list.map((b: { reference: string }) => b.reference), `${who} must not see other people's bookings`).not.toContain(a.reference);
      expect((await request.get(`bookings/${a.reference}`, { headers: await auth(who) })).status()).toBe(404);
    }
  });

  test('admin list searches and filters; detail shows timeline, voucher and invoice', async ({ request }) => {
    const headers = await auth('ops');
    const found = await (await request.get(`admin/bookings?q=${a.reference}`, { headers })).json();
    expect(found.items).toHaveLength(1);
    bookingId = found.items[0].id;
    expect(found.items[0]).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', customerEmail: emails.customer });
    expect((await (await request.get(`admin/bookings?q=${encodeURIComponent(emails.customer)}&status=confirmed&paymentStatus=paid&serviceType=activity&activity=${ACTIVITY}`, { headers })).json()).items.length).toBeGreaterThan(0);
    expect((await (await request.get(`admin/bookings?q=${a.reference}&status=cancelled`, { headers })).json()).items).toHaveLength(0);
    expect((await (await request.get(`admin/bookings?q=${a.reference}&paymentStatus=refunded`, { headers })).json()).items).toHaveLength(0);
    expect((await request.get('admin/bookings?status=bogus', { headers })).status()).toBe(400);
    expect((await request.get('admin/bookings?sort=passwordHash:asc', { headers })).status()).toBe(400);
    expect((await request.get('admin/bookings?limit=101', { headers })).status()).toBe(400);
    const orders = await (await request.get(`admin/bookings/orders?q=${a.orderReference}`, { headers })).json();
    expect(orders.items[0]).toMatchObject({ orderReference: a.orderReference, bookings: 1 });
    const order = await (await request.get(`admin/bookings/orders/${a.orderReference}`, { headers })).json();
    expect(order.bookings).toHaveLength(1);

    const detail = await (await request.get(`admin/bookings/${bookingId}`, { headers })).json();
    expect(detail.timeline.map((t: { type: string }) => t.type)).toEqual(expect.arrayContaining(['created', 'paid', 'voucher_issued']));
    expect(detail.voucher.code).toBe(voucherCode);
    voucherId = detail.voucher.id;
    expect(detail.invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(detail.actions).toMatchObject({ cancel: true, refund: false, editDate: true });
    expect(detail.customer.email).toBe(emails.customer);
    const finance = await (await request.get(`admin/bookings/${a.reference}`, { headers: await auth('finance') })).json();
    expect(finance.actions).toMatchObject({ refund: true, cancel: false });
  });

  test('notes are appended and permission checked', async ({ request }) => {
    expect((await request.post(`admin/bookings/${bookingId}/notes`, { headers: await auth('support'), data: { text: 'hi' } })).status()).toBe(403);
    expect((await request.post(`admin/bookings/${bookingId}/notes`, { headers: await auth('ops'), data: { text: '' } })).status()).toBe(400);
    expect((await request.post(`admin/bookings/${bookingId}/notes`, { headers: await auth('ops'), data: { text: 'x'.repeat(2001) } })).status()).toBe(400);
    const note = await request.post(`admin/bookings/${bookingId}/notes`, { headers: await auth('ops'), data: { text: 'Guest wants a quiet table' } });
    expect(note.status()).toBe(201);
    const detail = await (await request.get(`admin/bookings/${bookingId}`, { headers: await auth('ops') })).json();
    expect(detail.notes.map((n: { text: string }) => n.text)).toContain('Guest wants a quiet table');
  });

  test('changing the service date re-checks availability and is audited', async ({ request }) => {
    const headers = await auth('ops');
    const past = await request.patch(`admin/bookings/${bookingId}/service-date`, { headers, data: { date: '2020-01-01', reason: 'test' } });
    expect(past.status()).toBe(400);
    const same = await request.patch(`admin/bookings/${bookingId}/service-date`, { headers, data: { date: a.dates[0], reason: 'test' } });
    expect(same.status()).toBe(400);
    const invalid = await request.patch(`admin/bookings/${bookingId}/service-date`, { headers, data: { date: '2026-13-45', reason: 'test' } });
    expect(invalid.status()).toBe(400);
    const moved = await request.patch(`admin/bookings/${bookingId}/service-date`, { headers, data: { date: a.dates[1], reason: 'Customer asked' } });
    expect(moved.status()).toBe(200);
    expect((await moved.json()).serviceDay).toBe(a.dates[1]);
    const audit = await (await request.get(`admin/audit?entityId=${bookingId}&action=booking.service_date`, { headers: await auth('owner') })).json();
    expect(audit.items.length).toBeGreaterThan(0);
  });

  test('public lookup is minimal; the scanner validates, redeems once and refuses a second scan', async ({ request }) => {
    const pub = await (await request.get(`vouchers/${voucherCode}`)).json();
    expect(Object.keys(pub).sort()).toEqual(['activityTitle', 'adults', 'children', 'optionName', 'redeemedAt', 'serviceDay', 'startTime', 'status', 'valid']);
    expect(pub.status).toBe('too_early'); // moved to a future day
    const ops = await auth('ops');
    expect((await request.post('admin/vouchers/validate', { headers: ops, data: { code: 'garbage' } })).status()).toBe(400);
    expect((await request.post('admin/vouchers/validate', { headers: ops, data: { code: 'AAAAAAAAAAAAAAAA' } })).status()).toBe(404);
    const early = await (await request.post('admin/vouchers/validate', { headers: ops, data: { code: voucherCode } })).json();
    expect(early).toMatchObject({ verdict: 'too_early', ok: false });
    expect((await request.post(`admin/vouchers/${voucherId}/redeem`, { headers: ops })).status()).toBe(409);

    // Move the booking to today straight in the database so the date window opens.
    const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
    await connection.collection('bookings').updateOne({ reference: a.reference }, { $set: { serviceDay: today } });
    const valid = await (await request.post('admin/vouchers/validate', { headers: ops, data: { code: `https://x.example/v/${voucherCode.toLowerCase()}` } })).json();
    expect(valid).toMatchObject({ verdict: 'valid', ok: true, booking: { travellers: 2, reference: a.reference } });
    const [first, second] = await Promise.all([
      request.post(`admin/vouchers/${voucherId}/redeem`, { headers: ops }),
      request.post(`admin/vouchers/${voucherId}/redeem`, { headers: await auth('owner') }),
    ]);
    expect([first.status(), second.status()].sort()).toEqual([200, 409]);
    const loser = first.status() === 409 ? first : second;
    expect((await loser.json()).code).toBe('ALREADY_REDEEMED');
    const again = await request.post(`admin/vouchers/${voucherId}/redeem`, { headers: ops });
    expect(again.status()).toBe(409);
    expect((await again.json()).message).toContain('Already redeemed at');
    const list = await (await request.get(`admin/vouchers?q=${a.reference}&status=redeemed`, { headers: ops })).json();
    expect(list.items).toHaveLength(1);
    expect((await request.post(`admin/vouchers/${voucherId}/void`, { headers: ops, data: { reason: 'x' } })).status()).toBe(409);
  });

  let b: { reference: string; orderReference: string };
  let bId: string;

  test('customer cancellation request: queue, policy, approve without refund permission, then finance refunds', async ({ request }) => {
    b = await purchase(request, 2);
    const customer = await auth('customer');
    const requested = await request.post(`bookings/${b.reference}/cancellation`, { headers: customer });
    expect(requested.status()).toBe(201);
    const ops = await auth('ops');
    const queue = await (await request.get(`admin/bookings/cancellation-requests?q=${b.reference}`, { headers: ops })).json();
    expect(queue.items).toHaveLength(1);
    bId = queue.items[0].id;
    expect(queue.items[0].policy.refundAmount).toBeGreaterThan(0); // seeded options are refundable
    // Approving with the default (policy) refund needs bookings.refund, which operations lacks.
    const denied = await request.post(`admin/bookings/${bId}/cancellation/approve`, { headers: ops, data: {} });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe('REFUND_PERMISSION_REQUIRED');
    const approved = await request.post(`admin/bookings/${bId}/cancellation/approve`, { headers: ops, data: { refund: 'none', note: 'Refund by finance' } });
    expect(approved.status()).toBe(200);
    const view = await approved.json();
    expect(view.status).toBe('cancelled');
    expect(view.voucher.status).toBe('void');
    expect((await request.post(`admin/bookings/${bId}/cancel`, { headers: ops, data: { reason: 'again' } })).status()).toBe(409);
  });

  test('refunds are capped, idempotent and never happen twice; credit notes follow', async ({ request }) => {
    const finance = await auth('finance');
    const detail = await (await request.get(`admin/bookings/${bId}`, { headers: finance })).json();
    const total: number = detail.booking.total;
    expect((await request.post(`admin/bookings/${bId}/refund`, { headers: await auth('ops'), data: { amount: 1, reason: 'x' } })).status()).toBe(403);
    expect((await request.post(`admin/bookings/${bId}/refund`, { headers: finance, data: { amount: 0, reason: 'x' } })).status()).toBe(400);
    expect((await request.post(`admin/bookings/${bId}/refund`, { headers: finance, data: { amount: total + 0.01, reason: 'x' } })).status()).toBe(409);
    expect((await request.post(`admin/bookings/${bId}/refund`, { headers: finance, data: { amount: 5, reason: '' } })).status()).toBe(400);

    const key = `idem-${stamp}-1`;
    const partial = await request.post(`admin/bookings/${bId}/refund`, { headers: finance, data: { amount: 10, reason: 'Goodwill', idempotencyKey: key } });
    expect(partial.status()).toBe(200);
    const first = await partial.json();
    expect(first).toMatchObject({ replayed: false, refund: { amount: 10, mode: 'mock', status: 'succeeded' } });
    expect(first.refund.creditNoteNumber).toMatch(/^CN-\d{4}-\d{6}$/);
    const replay = await (await request.post(`admin/bookings/${bId}/refund`, { headers: finance, data: { amount: 10, reason: 'Goodwill', idempotencyKey: key } })).json();
    expect(replay).toMatchObject({ replayed: true, refund: { id: first.refund.id } });
    expect(replay.booking.refundable.remaining).toBeCloseTo(total - 10, 2);

    // Concurrent attempts for the remaining amount: exactly one succeeds, the paid amount is never exceeded.
    const rest = Math.round((total - 10) * 100) / 100;
    const results = await Promise.all([1, 2, 3].map(() => request.post(`admin/bookings/${bId}/refund`, { headers: finance, data: { amount: rest, reason: 'Rest' } })));
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
    const final = await (await request.get(`admin/bookings/${bId}`, { headers: finance })).json();
    expect(final.status).toBe('refunded');
    expect(final.booking.refundedAmount ?? final.refundedAmount).toBeCloseTo(total, 2);
    expect(final.refunds).toHaveLength(2);
    expect(final.creditNotes).toHaveLength(2);
    const creditTotal = final.creditNotes.reduce((s: number, c: { total: number }) => s + c.total, 0);
    expect(creditTotal).toBeCloseTo(total, 2);
    expect(final.invoice.status).toBe('refunded');
    expect((await request.post(`admin/bookings/${bId}/refund`, { headers: finance, data: { amount: 0.01, reason: 'again' } })).status()).toBe(409);

    const credit = final.creditNotes[0];
    const pdf = await request.get(`admin/invoices/${credit.id}/pdf`, { headers: finance });
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const audit = await (await request.get(`admin/audit?entityId=${bId}&action=booking.refund`, { headers: await auth('owner') })).json();
    expect(audit.items.length).toBe(3); // two successful + one replay
  });

  test('a rejected cancellation request returns the booking to confirmed', async ({ request }) => {
    const c = await purchase(request, 1);
    await request.post(`bookings/${c.reference}/cancellation`, { headers: await auth('customer') });
    const ops = await auth('ops');
    const row = (await (await request.get(`admin/bookings?q=${c.reference}`, { headers: ops })).json()).items[0];
    expect((await request.post(`admin/bookings/${row.id}/cancellation/reject`, { headers: ops, data: {} })).status()).toBe(400);
    const rejected = await request.post(`admin/bookings/${row.id}/cancellation/reject`, { headers: ops, data: { reason: 'Outside policy' } });
    expect(rejected.status()).toBe(200);
    expect((await rejected.json()).status).toBe('confirmed');
    const cancelled = await request.post(`admin/bookings/${row.id}/cancel`, { headers: ops, data: { reason: 'Customer called', refund: 'none' } });
    expect((await cancelled.json()).status).toBe('cancelled');
  });

  test('finance overview, reconciliation and invoices are consistent with the ledger', async ({ request }) => {
    const finance = await auth('finance');
    const overview = await (await request.get('admin/finance/overview', { headers: finance })).json();
    expect(overview.net).toBeCloseTo(overview.collected - overview.refunded, 2);
    expect(overview.byDay.length).toBeGreaterThanOrEqual(30);
    expect(overview.refunded).toBeGreaterThan(0);
    const recon = await (await request.get('admin/finance/reconciliation', { headers: finance })).json();
    expect(recon.totals.net).toBeCloseTo(recon.totals.payments - recon.totals.refunds, 2);
    expect(recon.totals.refunds).toBeCloseTo(overview.refunded, 2);
    const today = recon.days[0];
    expect(today.refunds).toBeGreaterThan(0);
    const csv = await request.get('admin/finance/reconciliation/export.csv', { headers: finance });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('Variance AED');
    const lines = await request.get('admin/finance/reconciliation/export.csv?view=lines', { headers: finance });
    expect(await lines.text()).toContain('Payment reference');
    expect((await request.get('admin/finance/overview?from=2026-01-01&to=2025-01-01', { headers: finance })).status()).toBe(400);
    expect((await request.get('admin/finance/overview?from=2020-01-01&to=2026-12-31', { headers: finance })).status()).toBe(400);
    const day = await (await request.get(`admin/finance/reconciliation/${today.date}`, { headers: finance })).json();
    expect(day.refunds.length).toBeGreaterThan(0);

    const invoices = await (await request.get(`admin/invoices?q=${a.reference}`, { headers: finance })).json();
    expect(invoices.items).toHaveLength(1);
    expect(invoices.items[0]).toMatchObject({ kind: 'invoice', customerEmail: emails.customer });
    const credit = await (await request.get(`admin/invoices?kind=credit_note&q=${b.reference}`, { headers: finance })).json();
    expect(credit.items.length).toBe(2);
    const csvInv = await request.get(`admin/invoices/export.csv?q=${a.reference}`, { headers: finance });
    expect(await csvInv.text()).toContain(invoices.items[0].invoiceNumber);
    const pdf = await request.get(`admin/invoices/${invoices.items[0].id}/pdf`, { headers: finance });
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('settings accept company details and validate the tax number', async ({ request }) => {
    const owner = await auth('owner');
    const current = await (await request.get('admin/settings/general', { headers: owner })).json();
    const bad = await request.put('admin/settings/general', { headers: owner, data: { ...current.values, taxNumber: '!!' } });
    expect(bad.status()).toBe(400);
    expect(current.values).toHaveProperty('legalName');
    expect(current.values).toHaveProperty('taxNumber');
  });

  test('legacy role and status routes are bound by the staff rules and audited', async ({ request }) => {
    const owner = await auth('owner');
    const self = await request.patch(`users/${ids.owner}/roles`, { headers: owner, data: { roles: ['customer'] } });
    expect(self.status()).toBe(403);
    const lastAdmin = await request.patch(`users/${ids.owner}/status`, { headers: owner, data: { status: 'suspended' } });
    expect(lastAdmin.status()).toBe(403);
    expect((await request.patch(`users/${ids.ops}/roles`, { headers: await auth('ops'), data: { roles: ['super_admin'] } })).status()).toBe(403);
    const change = await request.patch(`users/${ids.other}/roles`, { headers: owner, data: { roles: ['customer', 'support'] } });
    expect(change.status()).toBe(200);
    const audit = await (await request.get(`admin/audit?entityId=${ids.other}&action=user.roles`, { headers: owner })).json();
    expect(audit.items[0].changes[0]).toMatchObject({ field: 'roles' });
  });
});
