import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { expect, test } from '@playwright/test';
import { type ClerkClient, createClerkClient } from '@clerk/backend';
import mongoose from 'mongoose';

const REPORT_ROUTES = [
  'admin/dashboard',
  'admin/reports/sales',
  'admin/reports/sales/export.csv',
  'admin/reports/top-activities',
  'admin/reports/lead-funnel',
  'admin/reports/support',
  'admin/reports/cancellations',
];

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = resolve(process.cwd(), '.env');
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8'))[name] : undefined;
}

const secretKey = envValue('CLERK_SECRET_KEY')?.startsWith('sk_test_') ? envValue('CLERK_SECRET_KEY') : undefined;

test.describe('reports (anonymous)', () => {
  test('dashboard and every report answer 401 without a token', async ({ request }) => {
    for (const path of REPORT_ROUTES) expect((await request.get(path)).status(), path).toBe(401);
  });
});

/**
 * Data lives in March 2020, a window no real data touches, so every number can be asserted exactly.
 * Window A = 2020-03-09..2020-03-15 (7 days), previous window B = 2020-03-02..2020-03-08.
 * Everything is inserted straight into the database with an RPT- marker and deleted afterwards.
 */
test.describe('reports (Clerk-authenticated)', () => {
  test.skip(!secretKey, 'CLERK_SECRET_KEY for a Clerk development instance (sk_test_...) is not set');
  test.describe.configure({ mode: 'serial' });

  const mongoUri = envValue('MONGODB_URI') ?? 'mongodb://127.0.0.1:27017/tourvex_test';
  const stamp = Date.now();
  const roles = ['owner', 'sales', 'support', 'customer'] as const;
  type Who = (typeof roles)[number];
  const emails = Object.fromEntries(roles.map((who) => [who, `rpt-${who}-${stamp}+clerk_test@example.com`])) as Record<Who, string>;
  const staffRoles: Partial<Record<Who, string[]>> = { owner: ['super_admin'], sales: ['sales'], support: ['support'] };
  const clerkIds: string[] = [];
  const sessions: Partial<Record<Who, string>> = {};
  const ids: Partial<Record<Who, string>> = {};
  const query = '?from=2020-03-09&to=2020-03-15';
  let clerk: ClerkClient;
  let connection: mongoose.Connection;

  const auth = async (who: Who) => {
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
      const inserted = await users.insertOne({ firstName: 'Rpt', lastName: `Tester ${who}`, email: emails[who], roles: ['customer', ...(staffRoles[who] ?? [])], status: 'active', active: true, createdAt: new Date(), updatedAt: new Date() });
      ids[who] = inserted.insertedId.toString();
      const user = await clerk.users.createUser({ emailAddress: [emails[who]], username: `rpt_test_${randomBytes(6).toString('hex')}`, password: `${randomBytes(18).toString('base64url')}-Aa1!`, firstName: 'Rpt', lastName: `Tester ${who}`, skipPasswordChecks: true });
      clerkIds.push(user.id);
      sessions[who] = (await clerk.sessions.createSession({ userId: user.id })).id;
    }

    // ---- seed
    const customerId = new mongoose.Types.ObjectId(ids.customer);
    const at = (iso: string) => new Date(iso);
    const booking = (n: number, over: Record<string, unknown>) => ({
      reference: `RPT-${stamp}-${n}`, customerId, serviceType: 'activity', title: 'RPT Desert Safari', activitySlug: 'rpt-safari', quantity: 1, unitPrice: 100, subtotal: 100,
      total: 100, tax: 0, currency: 'AED', status: 'confirmed', customer: { fullName: 'Jane Doe Smith', email: 'x@example.com' }, createdAt: at('2020-03-10T10:00:00Z'), updatedAt: new Date(), ...over,
    });
    const bookings = [
      booking(1, { confirmedAt: at('2020-03-10T10:00:00Z') }),
      booking(2, { total: 200, confirmedAt: at('2020-03-10T20:30:00Z'), createdAt: at('2020-03-10T20:30:00Z') }), // 11 March in Dubai
      booking(3, { serviceType: 'hotel', title: 'RPT Hotel', activitySlug: undefined, total: 300, confirmedAt: at('2020-03-12T08:00:00Z'), createdAt: at('2020-03-12T08:00:00Z') }),
      booking(4, { total: 50, status: 'cancelled', createdAt: at('2020-03-13T08:00:00Z') }),
      booking(5, { total: 999, currency: 'USD', confirmedAt: at('2020-03-13T09:00:00Z'), createdAt: at('2020-03-13T09:00:00Z') }),
      booking(6, { total: 70, status: 'cancellation_requested', cancellationRequestedAt: at('2020-03-14T08:00:00Z'), createdAt: at('2020-03-14T08:00:00Z') }),
      booking(7, { confirmedAt: at('2020-03-05T10:00:00Z'), createdAt: at('2020-03-05T10:00:00Z') }), // previous window
    ];
    const inserted = await connection.collection('bookings').insertMany(bookings);
    const b1 = inserted.insertedIds[0];
    await connection.collection('refunds').insertMany([
      { bookingId: b1, bookingReference: `RPT-${stamp}-1`, amount: 40, amountMinor: 4000, currency: 'AED', reason: 'rpt', mode: 'mock', status: 'succeeded', actorId: customerId, createdAt: at('2020-03-11T10:00:00Z'), updatedAt: new Date() },
      { bookingId: b1, bookingReference: `RPT-${stamp}-1`, amount: 99, amountMinor: 9900, currency: 'AED', reason: 'rpt failed', mode: 'mock', status: 'failed', actorId: customerId, createdAt: at('2020-03-11T11:00:00Z'), updatedAt: new Date() },
    ]);
    const lead = (n: number, status: string, iso: string, source = 'contact') => ({ reference: `RPT-${stamp}-L${n}`, source, sourceRef: `RPT-${stamp}-L${n}`, name: 'Rpt Lead', email: `lead${n}@example.com`, status, tags: [], notes: [], timeline: [], marketingOptOut: false, consentAt: new Date(), createdAt: at(iso), updatedAt: new Date() });
    await connection.collection('leads').insertMany([lead(1, 'won', '2020-03-10T10:00:00Z'), lead(2, 'new', '2020-03-12T10:00:00Z', 'visa'), lead(3, 'lost', '2020-03-12T11:00:00Z'), lead(4, 'new', '2020-03-04T10:00:00Z')]);
    const ticket = (n: number, over: Record<string, unknown>) => ({ number: `RPT-${stamp}-T${n}`, subject: 'rpt', category: 'general', priority: 'normal', status: 'open', requester: { name: 'Rpt Person', email: 'p@example.com' }, messages: [], publicMessageCount: 0, createdAt: at('2020-03-10T10:00:00Z'), updatedAt: new Date(), ...over });
    await connection.collection('tickets').insertMany([
      ticket(1, { status: 'resolved', firstResponseAt: at('2020-03-10T10:30:00Z'), resolvedAt: at('2020-03-10T12:00:00Z') }),
      ticket(2, { status: 'closed', createdAt: at('2020-03-11T10:00:00Z') }),
      ticket(3, { status: 'open', createdAt: at('2020-03-12T10:00:00Z') }),
    ]);
    await connection.collection('vouchers').insertOne({ code: randomBytes(10).toString('hex').toUpperCase().slice(0, 16), bookingId: b1, bookingReference: `RPT-${stamp}-1`, status: 'redeemed', issuedAt: at('2020-03-10T10:00:00Z'), redeemedAt: at('2020-03-12T07:00:00Z'), resendCount: 0, createdAt: new Date(), updatedAt: new Date() });
    await users.insertOne({ firstName: 'Old', lastName: 'Customer', email: `rpt-old-${stamp}+clerk_test@example.com`, roles: ['customer'], status: 'active', active: true, createdAt: at('2020-03-10T10:00:00Z'), updatedAt: new Date() });
  });

  test.afterAll(async () => {
    for (const id of clerkIds) await clerk.users.deleteUser(id).catch(() => undefined);
    if (!connection) return;
    const marker = new RegExp(`^RPT-${stamp}`);
    const bookings = await connection.collection('bookings').find({ reference: marker }, { projection: { _id: 1 } }).toArray();
    await connection.collection('vouchers').deleteMany({ bookingId: { $in: bookings.map((b) => b._id) } });
    await connection.collection('refunds').deleteMany({ bookingReference: marker });
    await connection.collection('bookings').deleteMany({ reference: marker });
    await connection.collection('leads').deleteMany({ reference: marker });
    await connection.collection('tickets').deleteMany({ number: marker });
    const userIds = Object.values(ids).map((id) => new mongoose.Types.ObjectId(id));
    await connection.collection('audit_logs').deleteMany({ actorId: { $in: userIds } });
    await connection.collection('users').deleteMany({ email: { $regex: `^rpt-(owner|sales|support|customer|old)-${stamp}` } });
    await connection.close();
  });

  test.beforeEach(async ({ request }) => {
    const me = await request.get('admin/me', { headers: await auth('owner') });
    test.skip(me.status() !== 200, 'The API under test enforces azp or uses another database than MONGODB_URI (run it with NODE_ENV=test, CLERK_AUTHORIZED_PARTIES=* and the same database)');
  });

  test('customers and staff without dashboard.read get 403', async ({ request }) => {
    for (const path of REPORT_ROUTES) {
      expect((await request.get(path, { headers: await auth('customer') })).status(), `${path} as customer`).toBe(403);
    }
    expect((await request.get('admin/dashboard', { headers: await auth('support') })).status()).toBe(403);
  });

  test('range validation: bad preset, inverted and oversized ranges are 400', async ({ request }) => {
    const headers = await auth('owner');
    expect((await request.get('admin/dashboard?range=1y', { headers })).status()).toBe(400);
    expect((await request.get('admin/dashboard?from=2020-03-10&to=2020-03-01', { headers })).status()).toBe(400);
    const big = await request.get('admin/dashboard?from=2019-01-01&to=2020-03-01', { headers });
    expect(big.status()).toBe(400);
    expect((await big.json()).code).toBe('RANGE_TOO_LARGE');
    expect((await request.get('admin/dashboard?from=nonsense', { headers })).status()).toBe(400);
  });

  test('owner dashboard: exact KPIs, Dubai-day series, previous period and breakdowns', async ({ request }) => {
    const response = await request.get(`admin/dashboard${query}`, { headers: await auth('owner') });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const d = await response.json();
    expect(d.range).toMatchObject({ key: 'custom', from: '2020-03-09', to: '2020-03-15' });
    expect(d.range.days).toHaveLength(7);
    expect(d.previousRange).toEqual({ from: '2020-03-02', to: '2020-03-08' });
    expect(d.currency).toBe('AED');
    expect(Object.keys(d.kpis).sort()).toEqual(['bookings', 'cancellationRequests', 'customers', 'leads', 'refunds', 'revenue', 'tickets', 'vouchers']);

    // revenue: 100 + 200 + 300 AED confirmed, USD booking excluded, previous period 100
    expect(d.kpis.revenue).toMatchObject({ value: 600, previous: 100, deltaPct: 500, state: 'up' });
    expect(d.kpis.revenue.series).toEqual([0, 100, 200, 300, 0, 0, 0]); // 200 sits on 11 March: 20:30Z is already the next Dubai day
    expect(d.kpis.revenue.refunded).toMatchObject({ value: 40, previous: 0, deltaPct: null, state: 'new' });
    expect(d.kpis.revenue.net.value).toBe(560);
    expect(d.notes.excludedNonAed).toBe(1);

    expect(d.kpis.bookings).toMatchObject({ value: 6, previous: 1, deltaPct: 500 });
    expect(d.kpis.bookings.series).toEqual([0, 1, 1, 1, 2, 1, 0]);
    expect(d.kpis.leads).toMatchObject({ value: 3, previous: 1, deltaPct: 200 });
    expect(d.kpis.customers).toMatchObject({ value: 1, previous: 0, deltaPct: null, state: 'new' });
    expect(d.kpis.vouchers).toMatchObject({ value: 1, previous: 0 });
    expect(d.kpis.tickets.created).toMatchObject({ value: 3, previous: 0, goodWhen: 'down' });
    expect(d.kpis.tickets.open).toBeGreaterThanOrEqual(1);
    expect(d.kpis.cancellationRequests.pending).toBeGreaterThanOrEqual(1);
    expect(d.kpis.cancellationRequests.requested.value).toBe(1);

    const i = d.intelligence;
    expect(i.leadConversion).toMatchObject({ value: 33.3, numerator: 1, denominator: 3, previous: 0 });
    expect(i.cancellationRate).toMatchObject({ value: 16.7, numerator: 1, denominator: 6 });
    expect(i.averageBookingValue.value).toBe(200);
    expect(i.refundTotal).toMatchObject({ value: 40, count: 1 });
    expect(i.netRevenue.value).toBe(560);
    expect(i.slaCompliance).toMatchObject({ numerator: 1, denominator: 2, value: 50 });
    expect(i.bookingsToday).toBeDefined();

    expect(d.breakdowns.serviceTypes).toEqual(expect.arrayContaining([{ serviceType: 'hotel', revenue: 300, bookings: 1 }, { serviceType: 'activity', revenue: 300, bookings: 2 }]));
    expect(d.breakdowns.topActivities[0]).toMatchObject({ slug: 'rpt-safari', revenue: 300, bookings: 2 });
    expect(d.breakdowns.leadPipeline.find((s: { stage: string }) => s.stage === 'won').count).toBe(1);
    expect(d.insights.some((x: { id: string }) => x.id === 'cancellation-requests')).toBe(true);
    expect(d.summary.headline).toContain('Revenue is AED 600');
    expect(d.summary.attention.length).toBeGreaterThan(0);

    // privacy: activity names are first name + last initial, no e-mail addresses
    const text = JSON.stringify(d.activity);
    expect(text).not.toMatch(/@/);
    expect(text).not.toContain('Smith');
  });

  test('a sales user only receives the sections their permissions allow', async ({ request }) => {
    const response = await request.get(`admin/dashboard${query}`, { headers: await auth('sales') });
    expect(response.status()).toBe(200);
    const d = await response.json();
    // sales: dashboard.read, bookings.read, enquiries.*, customers.read; no finance, tickets or vouchers
    expect(Object.keys(d.kpis).sort()).toEqual(['bookings', 'cancellationRequests', 'customers', 'leads']);
    expect(d.sections.sort()).toEqual(['bookings', 'customers', 'leads']);
    expect(d.intelligence.revenue).toBeUndefined();
    expect(d.intelligence.netRevenue).toBeUndefined();
    expect(d.intelligence.refundTotal).toBeUndefined();
    expect(d.intelligence.slaCompliance).toBeUndefined();
    expect(d.breakdowns.serviceTypes).toBeUndefined();
    expect(d.breakdowns.topActivities).toBeUndefined();
    expect(d.notes.excludedNonAed).toBeUndefined();
    const raw = JSON.stringify(d);
    expect(raw).not.toMatch(/"revenue"|"refunded"|"overdue"/);
    expect(raw).not.toContain('AED 600');
    expect(d.activity.every((a: { type: string }) => a.type !== 'ticket')).toBe(true);
    expect(d.kpis.bookings.value).toBe(6);
  });

  test('reports enforce their own permissions', async ({ request }) => {
    const sales = await auth('sales');
    expect((await request.get(`admin/reports/sales${query}`, { headers: sales })).status()).toBe(403);
    expect((await request.get(`admin/reports/top-activities${query}`, { headers: sales })).status()).toBe(403);
    expect((await request.get(`admin/reports/cancellations${query}`, { headers: sales })).status()).toBe(403);
    expect((await request.get(`admin/reports/support${query}`, { headers: sales })).status()).toBe(403);
    expect((await request.get(`admin/reports/lead-funnel${query}`, { headers: sales })).status()).toBe(200);
  });

  test('sales report: by day and service, CSV is audited and formula-safe', async ({ request }) => {
    const headers = await auth('owner');
    const r = await (await request.get(`admin/reports/sales${query}`, { headers })).json();
    expect(r.totals).toMatchObject({ bookings: 3, revenue: 600, refunded: 40, net: 560, averageBookingValue: 200 });
    expect(r.byDay.map((x: { revenue: number }) => x.revenue)).toEqual([0, 100, 200, 300, 0, 0, 0]);
    expect(r.rows).toEqual([
      { date: '2020-03-10', serviceType: 'activity', bookings: 1, revenue: 100 },
      { date: '2020-03-11', serviceType: 'activity', bookings: 1, revenue: 200 },
      { date: '2020-03-12', serviceType: 'hotel', bookings: 1, revenue: 300 },
    ]);
    expect(r.excludedNonAed).toBe(1);

    const csv = await request.get(`admin/reports/sales/export.csv${query}`, { headers });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toContain('sales-by-day-and-service-2020-03-09_2020-03-15.csv');
    const text = await csv.text();
    expect(text).toContain('Date (Asia/Dubai),Service type,Confirmed bookings,Revenue AED');
    expect(text).toContain('2020-03-11,activity,1,200');
    const audit = await connection.collection('audit_logs').findOne({ actorId: new mongoose.Types.ObjectId(ids.owner), action: 'report.export' });
    expect(audit?.summary).toContain('sales-by-day-and-service');
  });

  test('top activities, funnel, support SLA and cancellations report real numbers', async ({ request }) => {
    const headers = await auth('owner');
    const top = await (await request.get(`admin/reports/top-activities${query}`, { headers })).json();
    expect(top.rows[0]).toMatchObject({ rank: 1, slug: 'rpt-safari', bookings: 2, revenue: 300, averageValue: 150 });
    const funnel = await (await request.get(`admin/reports/lead-funnel${query}`, { headers })).json();
    expect(funnel.totals).toMatchObject({ leads: 3, won: 1, lost: 1, conversionRate: 33.3 });
    expect(funnel.sources.find((s: { source: string }) => s.source === 'contact')).toMatchObject({ leads: 2, won: 1, lost: 1 });
    const support = await (await request.get(`admin/reports/support${query}`, { headers })).json();
    expect(support.totals).toMatchObject({ created: 3, met: 1, compliancePct: 50 });
    expect(support.byDay).toHaveLength(7);
    const cancel = await (await request.get(`admin/reports/cancellations${query}`, { headers })).json();
    expect(cancel.totals).toMatchObject({ created: 6, cancelledOrRefunded: 1, cancellationRatePct: 16.7, refunds: 1, refundedAmount: 40 });
    for (const name of ['top-activities', 'lead-funnel', 'support', 'cancellations']) {
      const csv = await request.get(`admin/reports/${name}/export.csv${query}`, { headers });
      expect(csv.status(), name).toBe(200);
      expect(csv.headers()['content-type']).toContain('text/csv');
    }
  });

  test('the old GET /admin/summary still works', async ({ request }) => {
    const response = await request.get('admin/summary', { headers: await auth('owner') });
    expect(response.status()).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual(['bookings', 'customers', 'enquiries', 'tickets']);
  });
});
