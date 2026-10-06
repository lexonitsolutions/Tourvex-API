import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { type ClerkClient, createClerkClient } from '@clerk/backend';
import { type APIRequestContext, expect, test } from '@playwright/test';
import mongoose from 'mongoose';

/** Customer-relations API: leads CRM, support tickets, customers and B2B partners. */

const ADMIN_ROUTES = [
  ['get', 'admin/leads'],
  ['get', 'admin/leads/pipeline'],
  ['get', 'admin/leads/stats'],
  ['get', 'admin/leads/owners'],
  ['get', 'admin/leads/export.csv'],
  ['post', 'admin/leads/bulk/assign'],
  ['post', 'admin/leads/bulk/status'],
  ['get', 'admin/leads/665f1c2b9a1e4b0012345678'],
  ['patch', 'admin/leads/665f1c2b9a1e4b0012345678'],
  ['post', 'admin/leads/665f1c2b9a1e4b0012345678/assign'],
  ['post', 'admin/leads/665f1c2b9a1e4b0012345678/status'],
  ['post', 'admin/leads/665f1c2b9a1e4b0012345678/follow-up'],
  ['post', 'admin/leads/665f1c2b9a1e4b0012345678/notes'],
  ['post', 'admin/leads/665f1c2b9a1e4b0012345678/contact'],
  ['get', 'admin/tickets'],
  ['get', 'admin/tickets/counts'],
  ['get', 'admin/tickets/assignees'],
  ['get', 'admin/tickets/export.csv'],
  ['post', 'admin/tickets/bulk/close'],
  ['get', 'admin/tickets/665f1c2b9a1e4b0012345678'],
  ['post', 'admin/tickets/665f1c2b9a1e4b0012345678/reply'],
  ['patch', 'admin/tickets/665f1c2b9a1e4b0012345678'],
  ['post', 'admin/tickets/665f1c2b9a1e4b0012345678/assign'],
  ['post', 'admin/tickets/665f1c2b9a1e4b0012345678/status'],
  ['get', 'admin/customers'],
  ['get', 'admin/customers/export.csv'],
  ['get', 'admin/customers/665f1c2b9a1e4b0012345678'],
  ['patch', 'admin/customers/665f1c2b9a1e4b0012345678'],
  ['post', 'admin/customers/665f1c2b9a1e4b0012345678/notes'],
  ['post', 'admin/customers/665f1c2b9a1e4b0012345678/deactivate'],
  ['post', 'admin/customers/665f1c2b9a1e4b0012345678/reactivate'],
  ['get', 'admin/partners'],
  ['get', 'admin/partners/counts'],
  ['get', 'admin/partners/export.csv'],
  ['get', 'admin/partners/665f1c2b9a1e4b0012345678'],
  ['post', 'admin/partners/665f1c2b9a1e4b0012345678/review'],
  ['patch', 'admin/partners/665f1c2b9a1e4b0012345678'],
] as const;

const CUSTOMER_ROUTES = [
  ['get', 'tickets'],
  ['post', 'tickets'],
  ['get', 'tickets/665f1c2b9a1e4b0012345678'],
  ['post', 'tickets/665f1c2b9a1e4b0012345678/messages'],
  ['post', 'tickets/665f1c2b9a1e4b0012345678/close'],
  ['post', 'tickets/665f1c2b9a1e4b0012345678/reopen'],
] as const;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** POST to a route throttled to 5 per minute, waiting out the window once if an earlier run is still counted. */
async function postThrottled(request: APIRequestContext, path: string, data: Record<string, unknown>, headers?: Record<string, string>) {
  let response = await request.post(path, { data, headers });
  if (response.status() === 429) {
    await sleep(61_000);
    response = await request.post(path, { data, headers });
  }
  return response;
}

/** The API throttles every route to 120 requests per minute per IP; heavy tests start in a fresh window. */
const freshThrottleWindow = () => sleep(61_000);

const postContact = (request: APIRequestContext, data: Record<string, unknown>) => postThrottled(request, 'contact', data);

test.describe('customer relations (anonymous)', () => {
  test('admin and customer routes answer 401 without a token', async ({ request }) => {
    for (const [method, path] of [...ADMIN_ROUTES, ...CUSTOMER_ROUTES]) {
      const response = await request[method](path, { data: method === 'get' ? undefined : {} });
      // 429 only when a throttled route was hit by an earlier request in the same minute; never a 2xx/4xx that skips auth
      expect([401, 429], `${method} ${path}`).toContain(response.status());
    }
  });

  test('POST /contact validates, requires consent and rejects unknown fields', async ({ request }) => {
    test.setTimeout(200_000);
    // The route is throttled to 5 per minute per IP (invalid requests count), so keep the number of calls small.
    const bad = await postContact(request, {
      fullName: 'x',
      email: 'nope',
      phone: 'abc',
      subject: 'Hello there',
      message: '',
      activitySlug: 'Not A Slug',
      consent: false,
    });
    expect(bad.status()).toBe(400);
    const messages: string[] = (await bad.json()).message;
    for (const field of ['fullName', 'email', 'phone', 'message', 'activitySlug', 'consent']) {
      expect(messages.some((m) => m.includes(field)), field).toBe(true);
    }
    const extra = await postContact(request, {
      fullName: 'Validation Check',
      email: 'validation-check@example.com',
      subject: 'Hello there',
      message: 'This should never be stored.',
      consent: true,
      isAdmin: true,
    });
    expect(extra.status()).toBe(400);
  });

  test('POST /catalog/activities/:slug/enquiries answers 404 for an unknown activity and 400 without consent', async ({
    request,
  }) => {
    const body = { fullName: 'Nobody Test', email: 'nobody@example.com', phone: '+971 50 000 0000', consent: true };
    expect((await request.post('catalog/activities/does-not-exist-xyz/enquiries', { data: body })).status()).toBe(404);
    expect(
      (await request.post('catalog/activities/does-not-exist-xyz/enquiries', { data: { ...body, consent: false } })).status(),
    ).toBe(400);
  });
});

function clerkTestSecretKey(): string | undefined {
  let key = process.env.CLERK_SECRET_KEY;
  const envFile = resolve(process.cwd(), '.env');
  if (!key && existsSync(envFile)) key = parseEnv(readFileSync(envFile, 'utf8')).CLERK_SECRET_KEY;
  return key?.startsWith('sk_test_') ? key : undefined;
}

function mongoUri(): string {
  let uri = process.env.MONGODB_URI;
  const envFile = resolve(process.cwd(), '.env');
  if (!uri && existsSync(envFile)) uri = parseEnv(readFileSync(envFile, 'utf8')).MONGODB_URI;
  return uri ?? 'mongodb://127.0.0.1:27017/tourvex_test';
}

/**
 * Real Clerk development tokens for throwaway users; staff are inserted straight into MongoDB.
 * Everything created (users, leads, tickets, audit entries) is removed afterwards.
 */
test.describe('customer relations (Clerk-authenticated)', () => {
  const secretKey = clerkTestSecretKey();
  test.skip(!secretKey, 'CLERK_SECRET_KEY for a Clerk development instance (sk_test_...) is not set');
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now();
  const emails = {
    admin: `crm-admin-${stamp}+clerk_test@example.com`,
    support: `crm-support-${stamp}+clerk_test@example.com`,
    alice: `crm-alice-${stamp}+clerk_test@example.com`,
    bob: `crm-bob-${stamp}+clerk_test@example.com`,
  };
  type Who = keyof typeof emails;
  const clerkIds: string[] = [];
  const sessions: Record<string, string> = {};
  let clerk: ClerkClient;
  let connection: mongoose.Connection;
  const ids: Record<string, string> = {};
  let supportSettingExisted = false;

  async function auth(who: Who) {
    const { jwt } = await clerk.sessions.getToken(sessions[who]);
    return { Authorization: `Bearer ${jwt}` };
  }

  async function createClerkUser(who: Who) {
    const user = await clerk.users.createUser({
      emailAddress: [emails[who]],
      username: `crm_test_${randomBytes(6).toString('hex')}`,
      password: `${randomBytes(18).toString('base64url')}-Aa1!`,
      firstName: 'Crm',
      lastName: `Tester ${who}`,
      skipPasswordChecks: true,
    });
    clerkIds.push(user.id);
    sessions[who] = (await clerk.sessions.createSession({ userId: user.id })).id;
  }

  test.beforeAll(async () => {
    clerk = createClerkClient({ secretKey });
    connection = await mongoose.createConnection(mongoUri()).asPromise();
    const users = connection.collection('users');
    const base = { status: 'active', active: true, createdAt: new Date(), updatedAt: new Date() };
    const admin = await users.insertOne({ ...base, firstName: 'Crm', lastName: 'Admin', email: emails.admin, roles: ['customer', 'super_admin'] });
    const support = await users.insertOne({ ...base, firstName: 'Crm', lastName: 'Support', email: emails.support, roles: ['customer', 'support'] });
    ids.admin = admin.insertedId.toString();
    ids.support = support.insertedId.toString();
    supportSettingExisted = Boolean(await connection.collection('site_settings').findOne({ group: 'support' }));
    for (const who of ['admin', 'support', 'alice', 'bob'] as const) await createClerkUser(who);
  });

  test.afterAll(async () => {
    for (const id of clerkIds) await clerk.users.deleteUser(id).catch(() => undefined);
    if (connection) {
      const addresses = Object.values(emails);
      const users = await connection
        .collection('users')
        .find({ email: { $in: addresses } }, { projection: { _id: 1 } })
        .toArray();
      const userIds = users.map((u) => u._id);
      await connection.collection('leads').deleteMany({ $or: [{ email: { $in: [...addresses, `crm-contact-${stamp}@example.com`, `crm-formula-${stamp}@example.com`, `crm-activity-${stamp}@example.com`] } }, { userId: { $in: userIds } }] });
      await connection.collection('holiday_enquiries').deleteMany({ email: `crm-holiday-${stamp}@example.com` });
      await connection.collection('visa_enquiries').deleteMany({ email: `crm-visa-${stamp}@example.com` });
      await connection.collection('leads').deleteMany({ email: { $in: [`crm-holiday-${stamp}@example.com`, `crm-visa-${stamp}@example.com`] } });
      await connection.collection('tickets').deleteMany({ 'requester.userId': { $in: userIds } });
      await connection.collection('audit_logs').deleteMany({
        $or: [{ actorId: { $in: userIds } }, { entityId: { $in: userIds.map(String) } }],
      });
      if (!supportSettingExisted) await connection.collection('site_settings').deleteMany({ group: 'support' });
      await connection.collection('users').deleteMany({ email: { $in: addresses } });
      await connection.close();
    }
  });

  let azpEnforced: boolean | undefined;
  test.beforeEach(async ({ request }) => {
    azpEnforced ??= (await request.get('auth/me', { headers: await auth('alice') })).status() === 401;
    test.skip(azpEnforced, 'The API under test enforces the Clerk azp claim; run it with NODE_ENV=test and CLERK_AUTHORIZED_PARTIES=*');
  });

  // ----------------------------------------------------------------- permissions

  test('a customer gets 403 on every admin route; a support agent only reaches tickets, customers (read) and enquiries (read)', async ({ request }) => {
    const customer = await auth('alice');
    for (const [method, path] of ADMIN_ROUTES) {
      const response = await request[method](path, { data: method === 'get' ? undefined : {}, headers: customer });
      expect(response.status(), `${method} ${path} as customer`).toBe(403);
    }
    const support = await auth('support');
    expect((await request.get('admin/tickets', { headers: support })).status()).toBe(200);
    expect((await request.get('admin/customers', { headers: support })).status()).toBe(200);
    expect((await request.get('admin/leads', { headers: support })).status()).toBe(200);
    // support has enquiries.read only, and no partners.* at all
    expect((await request.post('admin/leads/bulk/assign', { data: { ids: ['665f1c2b9a1e4b0012345678'], ownerId: null }, headers: support })).status()).toBe(403);
    expect((await request.get('admin/partners', { headers: support })).status()).toBe(403);
    expect((await request.post(`admin/customers/${ids.admin}/deactivate`, { data: {}, headers: support })).status()).toBe(403);
  });

  // ----------------------------------------------------------------- leads

  test('contact form: stored as a lead, honeypot ignored, csv safe', async ({ request }) => {
    test.setTimeout(200_000);
    await freshThrottleWindow();
    const admin = await auth('admin');
    const honey = await postContact(request, { fullName: 'Honey Bot', email: `crm-honey-${stamp}@example.com`, subject: 'Spam spam', message: 'buy now buy now', consent: true, website: 'http://spam.example' });
    expect(honey.status()).toBe(201);

    const created = await postContact(request, { fullName: 'Contact Person', email: `crm-contact-${stamp}@example.com`, phone: '+971 50 123 4567', subject: 'Question about tours', message: 'Do you run tours on Fridays?', consent: true });
    expect(created.status()).toBe(201);
    const { reference } = await created.json();
    expect(reference).toMatch(/^CON-[0-9A-F]{8}$/);

    // formula injection safe export
    const formula = await postContact(request, { fullName: '=HYPERLINK("http://x")', email: `crm-formula-${stamp}@example.com`, subject: 'Formula', message: 'Formula cell test', consent: true });
    expect(formula.status()).toBe(201);

    const list = await request.get('admin/leads', { headers: admin, params: { q: `crm-contact-${stamp}` } });
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.pagination.total).toBe(1);
    const lead = body.items[0];
    expect(lead).toMatchObject({ source: 'contact', sourceRef: reference, status: 'new', priority: 'normal', owner: null, subject: 'Question about tours' });
    expect(lead.reference).toMatch(/^LD-\d{6,}$/);
    ids.contactLead = lead.id;

    const honeyList = await request.get('admin/leads', { headers: admin, params: { q: `crm-honey-${stamp}` } });
    expect((await honeyList.json()).pagination.total).toBe(0);

    const csv = await request.get('admin/leads/export.csv', { headers: admin, params: { q: `crm-formula-${stamp}` } });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const text = await csv.text();
    expect(text.startsWith('﻿Reference,Created,Source')).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  test('lead workflow: assign, notes, follow-up, contact log, status rules, bulk, pipeline', async ({ request }) => {
    const admin = await auth('admin');
    const id = ids.contactLead;
    const base = `admin/leads/${id}`;

    // owner must be assignable staff
    expect((await request.post(`${base}/assign`, { data: { ownerId: ids.admin }, headers: admin })).status()).toBe(201);
    const assigned = await (await request.get(base, { headers: admin })).json();
    expect(assigned.owner).toMatchObject({ id: ids.admin });
    expect(assigned.timeline.some((e: { type: string }) => e.type === 'assigned')).toBe(true);
    // a non-staff id must be refused as owner (alice was provisioned by her first authenticated call)
    const alice = await connection.collection('users').findOne({ email: emails.alice });
    ids.alice = alice!._id.toString();
    const badOwner = await request.post(`${base}/assign`, { data: { ownerId: ids.alice }, headers: admin });
    expect(badOwner.status()).toBe(400);
    expect((await badOwner.json()).code).toBe('INVALID_OWNER');

    // notes
    const noted = await request.post(`${base}/notes`, { data: { text: 'Called, will ring back' }, headers: admin });
    expect(noted.status()).toBe(201);
    expect((await noted.json()).notes[0]).toMatchObject({ text: 'Called, will ring back' });
    expect((await request.post(`${base}/notes`, { data: { text: '' }, headers: admin })).status()).toBe(400);
    expect((await request.post(`${base}/notes`, { data: { text: 'x', extra: 1 }, headers: admin })).status()).toBe(400);

    // follow-up
    const past = await request.post(`${base}/follow-up`, { data: { at: '2020-01-01T10:00:00Z' }, headers: admin });
    expect(past.status()).toBe(400);
    const soon = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const scheduled = await (await request.post(`${base}/follow-up`, { data: { at: soon }, headers: admin })).json();
    expect(scheduled.nextFollowUpAt).toBe(soon);
    const dueFilter = await (await request.get('admin/leads', { headers: admin, params: { followUp: 'due', q: `crm-contact-${stamp}` } })).json();
    expect(dueFilter.pagination.total).toBeGreaterThanOrEqual(0);

    // contact log moves new -> contacted
    const contacted = await (await request.post(`${base}/contact`, { data: { channel: 'whatsapp', note: 'Sent a message' }, headers: admin })).json();
    expect(contacted.status).toBe('contacted');
    expect(contacted.lastContactedAt).toBeTruthy();
    expect((await request.post(`${base}/contact`, { data: { channel: 'carrier-pigeon' }, headers: admin })).status()).toBe(400);

    // status rules
    const lostNoReason = await request.post(`${base}/status`, { data: { status: 'lost' }, headers: admin });
    expect(lostNoReason.status()).toBe(409);
    expect((await lostNoReason.json()).code).toBe('LOST_REASON_REQUIRED');
    expect((await request.post(`${base}/status`, { data: { status: 'new' }, headers: admin })).status()).toBe(409);
    expect((await request.post(`${base}/status`, { data: { status: 'bogus' }, headers: admin })).status()).toBe(400);
    expect((await request.post(`${base}/status`, { data: { status: 'qualified' }, headers: admin })).status()).toBe(201);
    expect((await request.post(`${base}/status`, { data: { status: 'quoted' }, headers: admin })).status()).toBe(201);
    expect((await request.patch(base, { data: { priority: 'high', tags: ['vip', 'fridays'], valueAed: 4200.5 }, headers: admin })).status()).toBe(200);
    const won = await (await request.post(`${base}/status`, { data: { status: 'won' }, headers: admin })).json();
    expect(won).toMatchObject({ status: 'won', priority: 'high', valueAed: 4200.5, tags: ['vip', 'fridays'] });
    expect(won.closedAt).toBeTruthy();
    // closed leads can only be reopened, and have no follow-up
    expect((await request.post(`${base}/status`, { data: { status: 'lost', lostReason: 'price' }, headers: admin })).status()).toBe(409);
    expect((await request.post(`${base}/follow-up`, { data: { at: soon }, headers: admin })).status()).toBe(409);
    const reopened = await (await request.post(`${base}/status`, { data: { status: 'contacted' }, headers: admin })).json();
    expect(reopened.status).toBe('contacted');
    const lost = await (await request.post(`${base}/status`, { data: { status: 'lost', lostReason: 'changed_plans', note: 'Postponed' }, headers: admin })).json();
    expect(lost).toMatchObject({ status: 'lost', lostReason: 'changed_plans' });

    // timeline records every change, newest first
    const detail = await (await request.get(base, { headers: admin })).json();
    const types = detail.timeline.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['created', 'assigned', 'follow_up', 'contact', 'status', 'priority']));
    expect(new Date(detail.timeline[0].at).getTime()).toBeGreaterThanOrEqual(new Date(detail.timeline.at(-1).at).getTime());

    // bulk
    const second = await (await request.get('admin/leads', { headers: admin, params: { q: `crm-formula-${stamp}` } })).json();
    ids.formulaLead = second.items[0].id;
    const bulkAssign = await (await request.post('admin/leads/bulk/assign', { data: { ids: [ids.formulaLead, id], ownerId: ids.admin }, headers: admin })).json();
    expect(bulkAssign).toMatchObject({ requested: 2 });
    expect((await request.post('admin/leads/bulk/assign', { data: { ids: [], ownerId: null }, headers: admin })).status()).toBe(400);
    const bulkStatus = await (await request.post('admin/leads/bulk/status', { data: { ids: [ids.formulaLead, id], status: 'qualified' }, headers: admin })).json();
    // the formula lead is still new (qualified is allowed from new); the lost one cannot jump to qualified
    expect(bulkStatus.updated).toBe(1);
    expect(bulkStatus.skipped).toEqual([{ id, code: 'LEAD_CLOSED' }]);

    // list filters and pipeline
    const mine = await (await request.get('admin/leads', { headers: admin, params: { owner: ids.admin, status: 'qualified,quoted' } })).json();
    expect(mine.items.map((l: { id: string }) => l.id)).toContain(ids.formulaLead);
    const unassigned = await (await request.get('admin/leads', { headers: admin, params: { owner: 'unassigned' } })).json();
    expect(unassigned.items.every((l: { owner: unknown }) => l.owner === null)).toBe(true);
    expect((await request.get('admin/leads', { headers: admin, params: { sort: 'password:asc' } })).status()).toBe(400);
    expect((await request.get('admin/leads', { headers: admin, params: { status: 'nonsense' } })).status()).toBe(400);
    const pipeline = await (await request.get('admin/leads/pipeline', { headers: admin })).json();
    expect(pipeline.columns.map((c: { status: string }) => c.status)).toEqual(['new', 'contacted', 'qualified', 'quoted', 'won', 'lost']);
    expect(pipeline.totals).toEqual(expect.objectContaining({ open: expect.any(Number), overdue: expect.any(Number), dueToday: expect.any(Number), unassigned: expect.any(Number) }));
    const owners = await (await request.get('admin/leads/owners', { headers: admin })).json();
    expect(owners.map((o: { id: string }) => o.id)).toContain(ids.admin);
    // support has no enquiries.write, so it cannot own leads
    expect(owners.map((o: { id: string }) => o.id)).not.toContain(ids.support);
    expect((await request.post(`${base}/assign`, { data: { ownerId: ids.support }, headers: admin })).status()).toBe(400);

    // support has enquiries.read only: reads the lead, cannot change it
    const support = await auth('support');
    expect((await request.get(base, { headers: support })).status()).toBe(200);
    expect((await request.post(`${base}/notes`, { data: { text: 'nope' }, headers: support })).status()).toBe(403);
    expect((await request.get('admin/leads/export.csv', { headers: support })).status()).toBe(403);
  });

  test('holiday and visa enquiries also create a lead, with the corrected holiday payload', async ({ request }) => {
    const admin = await auth('admin');
    const listing = await (await request.get('holidays?limit=1')).json();
    test.skip(!listing.items?.length, 'No visible holiday package in this database');
    const slug = listing.items[0].slug;
    const email = `crm-holiday-${stamp}@example.com`;
    const payload = {
      fullName: 'Holiday Maker',
      email,
      phone: '+971 501234567',
      travelers: 3,
      travelDate: '2027-02-14',
      totalAmount: 5400.25,
      currency: 'AED',
      nationality: 'Indian',
      adults: 2,
      children: 1,
      marketingOptOut: true,
      message: 'Package: test. Travellers: 2 adults, 1 child.',
      consent: true,
    };
    // the old browser payload shape is not accepted
    expect((await request.post(`holidays/${slug}/enquiries`, { data: { ...payload, holidayTitle: 'x', name: 'x' } })).status()).toBe(400);
    expect((await request.post(`holidays/${slug}/enquiries`, { data: { ...payload, totalAmount: 5400.256 } })).status()).toBe(400);
    expect((await request.post(`holidays/${slug}/enquiries`, { data: { ...payload, consent: false } })).status()).toBe(400);
    const created = await request.post(`holidays/${slug}/enquiries`, { data: payload });
    expect(created.status()).toBe(201);
    const { reference } = await created.json();

    const found = await (await request.get('admin/leads', { headers: admin, params: { q: email } })).json();
    expect(found.pagination.total).toBe(1);
    expect(found.items[0]).toMatchObject({ source: 'holiday', sourceRef: reference, pax: 3, adults: 2, children: 1, valueAed: 5400.25, nationality: 'Indian', marketingOptOut: true });
    expect(found.items[0].catalog).toMatchObject({ type: 'holiday', slug });

    // idempotent by reference: the same client reference cannot create a second lead
    const again = await request.post(`holidays/${slug}/enquiries`, { data: { ...payload, reference } });
    expect([400, 201]).toContain(again.status());
    const after = await (await request.get('admin/leads', { headers: admin, params: { q: email } })).json();
    expect(after.pagination.total).toBe(1);

    const visas = await (await request.get('visas?limit=1')).json();
    if (visas.items?.length) {
      const visaEmail = `crm-visa-${stamp}@example.com`;
      const visa = await request.post(`visas/${visas.items[0].slug}/enquiries`, {
        data: { fullName: 'Visa Seeker', email: visaEmail, phone: '+971 50 111 2222', nationality: 'Egyptian', travellers: 2, message: 'Need info', consent: true },
      });
      expect(visa.status()).toBe(201);
      const foundVisa = await (await request.get('admin/leads', { headers: admin, params: { q: visaEmail } })).json();
      expect(foundVisa.items[0]).toMatchObject({ source: 'visa', pax: 2, nationality: 'Egyptian' });
    }
  });

  test('activity enquiry endpoint creates an activity lead', async ({ request }) => {
    const admin = await auth('admin');
    const listing = await (await request.get('catalog/activities?limit=1')).json();
    test.skip(!listing.items?.length, 'No activities in this database');
    const slug = listing.items[0].slug;
    const email = `crm-activity-${stamp}@example.com`;
    const created = await request.post(`catalog/activities/${slug}/enquiries`, {
      data: { fullName: 'Activity Asker', email, phone: '+971 50 222 3333', guests: 4, preferredDate: '2027-01-20', message: 'Private group?', consent: true },
    });
    expect(created.status()).toBe(201);
    expect((await created.json()).reference).toMatch(/^ACT-[0-9A-F]{8}$/);
    const found = await (await request.get('admin/leads', { headers: admin, params: { q: email } })).json();
    expect(found.items[0]).toMatchObject({ source: 'activity', pax: 4 });
    expect(found.items[0].catalog).toMatchObject({ type: 'activity', slug });
  });

  // ----------------------------------------------------------------- tickets

  test('support settings group: default targets, validation, update', async ({ request }) => {
    const admin = await auth('admin');
    const view = await (await request.get('admin/settings/support', { headers: admin })).json();
    expect(view.group).toBe('support');
    if (!supportSettingExisted) expect(view.values).toEqual({ firstResponseHours: 4, resolutionHours: 48 });
    expect((await request.put('admin/settings/support', { data: { firstResponseHours: 0, resolutionHours: 48 }, headers: admin })).status()).toBe(400);
    expect((await request.put('admin/settings/support', { data: { firstResponseHours: 4, resolutionHours: 48, extra: 1 }, headers: admin })).status()).toBe(400);
    const saved = await request.put('admin/settings/support', { data: { firstResponseHours: 4, resolutionHours: 48 }, headers: admin });
    expect(saved.status()).toBe(200);
  });

  test('customer tickets: ownership, validation, internal notes hidden, reopen rules', async ({ request }) => {
    test.setTimeout(200_000);
    await freshThrottleWindow();
    const alice = await auth('alice');
    const bob = await auth('bob');
    // POST /tickets is throttled to 5 per minute, so invalid input is exercised with few calls
    const invalid = await request.post('tickets', { data: { subject: 'Hi', category: 'nonsense', body: 'x'.repeat(5001) }, headers: alice });
    expect(invalid.status()).toBe(400);
    const problems: string[] = (await invalid.json()).message;
    for (const field of ['subject', 'category', 'body']) expect(problems.some((m) => m.includes(field)), field).toBe(true);
    expect((await request.post('tickets', { data: { subject: 'Valid subject', category: 'general', body: 'x', status: 'resolved' }, headers: alice })).status()).toBe(400);
    // a booking that is not yours cannot be linked
    const foreign = await request.post('tickets', { data: { subject: 'About a booking', category: 'booking', body: 'Help', bookingId: '665f1c2b9a1e4b0012345678' }, headers: alice });
    expect(foreign.status()).toBe(400);
    expect((await foreign.json()).code).toBe('BOOKING_NOT_FOUND');

    const created = await postThrottled(request, 'tickets', { subject: 'Voucher not received', category: 'voucher', body: 'I never got my voucher email.' }, alice);
    expect(created.status()).toBe(201);
    const ticket = await created.json();
    expect(ticket.number).toMatch(/^TKT-\d{6,}$/);
    expect(ticket).toMatchObject({ status: 'open', category: 'voucher', priority: 'normal', assignee: null });
    expect(ticket.requester.email).toBe(emails.alice);
    expect(ticket.messages).toHaveLength(1);
    ids.ticket = ticket.id;

    const second = await (await postThrottled(request, 'tickets', { subject: 'Another question', category: 'complaint', body: 'Complaint text' }, alice)).json();
    ids.ticket2 = second.id;
    expect(second.priority).toBe('high');
    const seq = (n: string) => Number(n.split('-')[1]);
    expect(seq(second.number)).toBeGreaterThan(seq(ticket.number));

    const mine = await (await request.get('tickets', { headers: alice })).json();
    expect(mine.items.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining([ids.ticket, ids.ticket2]));
    expect(mine.items[0].messages).toBeUndefined();
    // strict ownership
    expect((await request.get(`tickets/${ids.ticket}`, { headers: bob })).status()).toBe(404);
    expect((await request.post(`tickets/${ids.ticket}/messages`, { data: { body: 'hijack' }, headers: bob })).status()).toBe(404);
    expect((await request.post(`tickets/${ids.ticket}/close`, { data: {}, headers: bob })).status()).toBe(404);
    expect(((await (await request.get('tickets', { headers: bob })).json()).items as unknown[]).length).toBe(0);
    expect((await request.get('tickets/not-an-id', { headers: alice })).status()).toBe(404);

    // staff replies
    const admin = await auth('admin');
    const support = await auth('support');
    const note = await request.post(`admin/tickets/${ids.ticket}/reply`, { data: { body: 'Checking with ops (internal)', internal: true }, headers: support });
    expect(note.status()).toBe(201);
    let staffView = await note.json();
    expect(staffView.firstResponseAt).toBeNull(); // an internal note is not a first response
    const reply = await request.post(`admin/tickets/${ids.ticket}/reply`, { data: { body: 'We have resent your voucher.' }, headers: support });
    expect(reply.status()).toBe(201);
    staffView = await reply.json();
    expect(staffView).toMatchObject({ status: 'pending' });
    expect(staffView.firstResponseAt).toBeTruthy();
    expect(staffView.assignee).toMatchObject({ id: ids.support }); // first public reply self-assigns
    expect(staffView.sla).toMatchObject({ firstResponse: 'met', breached: false });

    // customer view hides internal notes and staff names
    const customerView = await (await request.get(`tickets/${ids.ticket}`, { headers: alice })).json();
    expect(customerView.messages.map((m: { body: string }) => m.body)).not.toContain('Checking with ops (internal)');
    expect(customerView.assignee).toBeNull();
    const staffMsg = customerView.messages.find((m: { authorType: string }) => m.authorType === 'staff');
    expect(staffMsg.authorName).toBe('Support team');
    expect(customerView.status).toBe('pending');

    // customer replies: pending -> open
    const back = await (await request.post(`tickets/${ids.ticket}/messages`, { data: { body: 'Thanks, got it' }, headers: alice })).json();
    expect(back.status).toBe('open');
    expect((await request.post(`tickets/${ids.ticket}/messages`, { data: { body: '' }, headers: alice })).status()).toBe(400);

    // resolve, then the customer replying brings it back
    expect((await request.post(`admin/tickets/${ids.ticket}/status`, { data: { status: 'resolved' }, headers: support })).status()).toBe(201);
    expect((await request.post(`admin/tickets/${ids.ticket}/status`, { data: { status: 'resolved' }, headers: support })).status()).toBe(409);
    const resolved = await (await request.get(`admin/tickets/${ids.ticket}`, { headers: support })).json();
    expect(resolved.resolvedAt).toBeTruthy();
    expect(resolved.sla.resolution).toBe('met');

    // closing and reopening
    const closed = await (await request.post(`tickets/${ids.ticket}/close`, { data: {}, headers: alice })).json();
    expect(closed.status).toBe('closed');
    expect((await request.post(`tickets/${ids.ticket}/messages`, { data: { body: 'late' }, headers: alice })).status()).toBe(409);
    expect((await request.post(`admin/tickets/${ids.ticket}/reply`, { data: { body: 'public reply on closed' }, headers: support })).status()).toBe(409);
    expect((await request.post(`admin/tickets/${ids.ticket}/reply`, { data: { body: 'internal ok on closed', internal: true }, headers: support })).status()).toBe(201);
    const reopened = await (await request.post(`tickets/${ids.ticket}/reopen`, { data: {}, headers: alice })).json();
    expect(reopened.status).toBe('open');
    expect((await request.post(`tickets/${ids.ticket}/reopen`, { data: {}, headers: alice })).status()).toBe(409);

    // staff queue: tabs, filters, search, assign, priority, bulk close, counts, export
    const unassigned = await (await request.get('admin/tickets', { headers: admin, params: { tab: 'unassigned', q: emails.alice } })).json();
    expect(unassigned.items.map((t: { id: string }) => t.id)).toContain(ids.ticket2);
    const byNumber = await (await request.get('admin/tickets', { headers: admin, params: { q: ticket.number } })).json();
    expect(byNumber.items.map((t: { id: string }) => t.id)).toContain(ids.ticket);
    const overdue = await (await request.get('admin/tickets', { headers: admin, params: { tab: 'overdue' } })).json();
    expect(overdue.items.map((t: { id: string }) => t.id)).not.toContain(ids.ticket2); // just created
    const badAssignee = await request.post(`admin/tickets/${ids.ticket2}/assign`, { data: { assigneeId: ids.alice }, headers: admin });
    expect(badAssignee.status()).toBe(400);
    const assignedTicket = await (await request.post(`admin/tickets/${ids.ticket2}/assign`, { data: { assigneeId: ids.support }, headers: admin })).json();
    expect(assignedTicket.assignee).toMatchObject({ id: ids.support });
    const mineTab = await (await request.get('admin/tickets', { headers: support, params: { tab: 'mine' } })).json();
    expect(mineTab.items.map((t: { id: string }) => t.id)).toContain(ids.ticket2);
    expect((await request.patch(`admin/tickets/${ids.ticket2}`, { data: { priority: 'urgent' }, headers: admin })).status()).toBe(200);
    expect((await request.patch(`admin/tickets/${ids.ticket2}`, { data: { priority: 'critical' }, headers: admin })).status()).toBe(400);
    const counts = await (await request.get('admin/tickets/counts', { headers: admin })).json();
    expect(counts).toEqual(expect.objectContaining({ mine: expect.any(Number), unassigned: expect.any(Number), all: expect.any(Number), overdue: expect.any(Number) }));
    const csv = await request.get('admin/tickets/export.csv', { headers: admin, params: { q: emails.alice } });
    expect(csv.status()).toBe(200);
    expect((await csv.text()).startsWith('﻿Number,Created,Subject')).toBe(true);

    // an overdue ticket shows up in the Overdue SLA tab (backdate the creation time directly)
    await connection.collection('tickets').updateOne({ _id: new mongoose.Types.ObjectId(ids.ticket2) }, { $set: { createdAt: new Date(Date.now() - 5 * 3_600_000) } });
    const late = await (await request.get('admin/tickets', { headers: admin, params: { tab: 'overdue', q: emails.alice } })).json();
    expect(late.items.map((t: { id: string }) => t.id)).toContain(ids.ticket2);
    expect(late.items.find((t: { id: string }) => t.id === ids.ticket2).sla).toMatchObject({ firstResponse: 'breached', breached: true });

    const bulk = await (await request.post('admin/tickets/bulk/close', { data: { ids: [ids.ticket2, ids.ticket] }, headers: support })).json();
    expect(bulk.updated).toBe(2);
    expect((await request.post('admin/tickets/bulk/close', { data: { ids: ['nope'] }, headers: support })).status()).toBe(400);
  });

  // ----------------------------------------------------------------- customers and partners

  test('customers: list, detail with lifetime value, tags, notes, deactivate and reactivate', async ({ request }) => {
    test.setTimeout(200_000);
    await freshThrottleWindow();
    const admin = await auth('admin');
    const support = await auth('support');
    const listed = await (await request.get('admin/customers', { headers: admin, params: { q: emails.alice } })).json();
    expect(listed.pagination.total).toBe(1);
    expect(listed.items[0]).toMatchObject({ id: ids.alice, email: emails.alice, active: true, stats: { bookings: 0, confirmed: 0, lifetimeValueAed: 0 } });
    // staff never appear as customers
    const staffSearch = await (await request.get('admin/customers', { headers: admin, params: { q: emails.admin } })).json();
    expect(staffSearch.pagination.total).toBe(0);
    expect((await request.get(`admin/customers/${ids.admin}`, { headers: admin })).status()).toBe(404);

    // lifetime value counts confirmed AED bookings only
    const bookings = connection.collection('bookings');
    const customerId = new mongoose.Types.ObjectId(ids.alice);
    const mk = (status: string, total: number, currency: string, tag: string) => ({
      reference: `TVX-CRMTEST-${stamp}-${tag}`, customerId, serviceType: 'activity', title: `CRM test ${tag}`, quantity: 1,
      unitPrice: total, subtotal: total, partnerDiscount: 0, tax: 0, total, currency, status, refundable: true,
      cancellationPolicy: 'x', createdAt: new Date(), updatedAt: new Date(),
    });
    await bookings.insertMany([mk('confirmed', 100.5, 'AED', 'A'), mk('confirmed', 50, 'AED', 'B'), mk('cancelled', 999, 'AED', 'C'), mk('confirmed', 77, 'USD', 'D')]);
    try {
      const detail = await (await request.get(`admin/customers/${ids.alice}`, { headers: support })).json();
      expect(detail.stats).toMatchObject({ bookings: 4, confirmed: 3, lifetimeValueAed: 150.5, otherCurrencyConfirmed: 1 });
      expect(detail.bookings).toHaveLength(4);
      expect(detail.tickets.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining([ids.ticket, ids.ticket2]));
      expect(detail.tickets[0].messages).toBeUndefined();
      expect(Array.isArray(detail.leads)).toBe(true);
    } finally {
      await bookings.deleteMany({ reference: new RegExp(`^TVX-CRMTEST-${stamp}-`) });
    }

    expect((await request.patch(`admin/customers/${ids.alice}`, { data: { tags: ['vip', 'repeat'], marketingOptOut: true }, headers: admin })).status()).toBe(200);
    expect((await request.patch(`admin/customers/${ids.alice}`, { data: { tags: ['BAD TAG!'] }, headers: admin })).status()).toBe(400);
    expect((await request.patch(`admin/customers/${ids.alice}`, { data: {}, headers: admin })).status()).toBe(400);
    const optedOut = await (await request.get('admin/customers', { headers: admin, params: { marketingOptOut: 'true', tag: 'vip', q: emails.alice } })).json();
    expect(optedOut.pagination.total).toBe(1);
    // support reads customers but cannot write them
    expect((await request.post(`admin/customers/${ids.alice}/notes`, { data: { text: 'nope' }, headers: support })).status()).toBe(403);
    expect((await request.post(`admin/customers/${ids.alice}/notes`, { data: { text: 'Prefers WhatsApp' }, headers: admin })).status()).toBe(201);
    const withNotes = await (await request.get(`admin/customers/${ids.alice}`, { headers: admin })).json();
    expect(withNotes.notes[0]).toMatchObject({ text: 'Prefers WhatsApp' });
    expect(withNotes).toMatchObject({ tags: ['vip', 'repeat'], marketingOptOut: true });

    // deactivation: customers.delete only, audited, effective immediately, reversible
    expect((await request.post(`admin/customers/${ids.alice}/deactivate`, { data: {}, headers: support })).status()).toBe(403);
    const off = await request.post(`admin/customers/${ids.alice}/deactivate`, { data: { reason: 'Chargeback abuse' }, headers: admin });
    expect(off.status()).toBe(201);
    expect((await off.json()).active).toBe(false);
    expect((await request.post(`admin/customers/${ids.alice}/deactivate`, { data: {}, headers: admin })).status()).toBe(409);
    expect((await request.get('tickets', { headers: await auth('alice') })).status()).toBe(403);
    const inactive = await (await request.get('admin/customers', { headers: admin, params: { status: 'inactive', q: emails.alice } })).json();
    expect(inactive.pagination.total).toBe(1);
    const on = await request.post(`admin/customers/${ids.alice}/reactivate`, { data: {}, headers: admin });
    expect((await on.json()).active).toBe(true);
    expect((await request.get('tickets', { headers: await auth('alice') })).status()).toBe(200);

    const audit = await (await request.get('admin/audit', { headers: admin, params: { entityId: ids.alice, entityType: 'customer' } })).json();
    expect(audit.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['customer.deactivate', 'customer.reactivate', 'customer.update']));

    const csv = await request.get('admin/customers/export.csv', { headers: admin, params: { q: emails.alice } });
    expect((await csv.text()).startsWith('﻿Name,Email,Joined')).toBe(true);
  });

  test('partners: applications are reviewed with reason, role and terms', async ({ request }) => {
    const admin = await auth('admin');
    const bob = await auth('bob');
    await request.get('auth/me', { headers: bob }); // provision bob
    const bobUser = await connection.collection('users').findOne({ email: emails.bob });
    ids.bob = bobUser!._id.toString();

    const apply = await request.post('users/me/partner-application', { data: { companyName: `CRM Test Travel ${stamp}`, phone: '+971 4 123 4567', website: 'https://example.com', message: 'We sell tours' }, headers: bob });
    expect(apply.status()).toBe(201);

    const pending = await (await request.get('admin/partners', { headers: admin, params: { status: 'pending', q: `CRM Test Travel ${stamp}` } })).json();
    expect(pending.pagination.total).toBe(1);
    expect(pending.items[0]).toMatchObject({ id: ids.bob, company: `CRM Test Travel ${stamp}`, applicationStatus: 'pending', profile: null });
    const counts = await (await request.get('admin/partners/counts', { headers: admin })).json();
    expect(counts.pending).toBeGreaterThanOrEqual(1);

    // rules
    const noReason = await request.post(`admin/partners/${ids.bob}/review`, { data: { decision: 'reject' }, headers: admin });
    expect(noReason.status()).toBe(400);
    expect((await noReason.json()).code).toBe('REASON_REQUIRED');
    expect((await request.post(`admin/partners/${ids.bob}/review`, { data: { decision: 'approve', discountPercent: 150 }, headers: admin })).status()).toBe(400);
    expect((await request.post(`admin/partners/${ids.bob}/review`, { data: { decision: 'approve', role: 'admin' }, headers: admin })).status()).toBe(400);
    expect((await request.post(`admin/partners/${ids.bob}/review`, { data: { decision: 'maybe' }, headers: admin })).status()).toBe(400);
    expect((await request.patch(`admin/partners/${ids.bob}`, { data: { discountPercent: 5 }, headers: admin })).status()).toBe(409); // not approved yet

    // reject then the applicant re-applies, then approve
    const rejected = await (await request.post(`admin/partners/${ids.bob}/review`, { data: { decision: 'reject', reason: 'Missing trade licence' }, headers: admin })).json();
    expect(rejected).toMatchObject({ applicationStatus: 'rejected', reviewNote: 'Missing trade licence' });
    expect((await request.post(`admin/partners/${ids.bob}/review`, { data: { decision: 'approve' }, headers: admin })).status()).toBe(409);
    expect((await request.post('users/me/partner-application', { data: { companyName: `CRM Test Travel ${stamp}` }, headers: bob })).status()).toBe(201);

    const approved = await (await request.post(`admin/partners/${ids.bob}/review`, { data: { decision: 'approve', role: 'b2b_manager', discountPercent: 12.5, creditTermsDays: 30, creditLimitAed: 20000 }, headers: admin })).json();
    expect(approved).toMatchObject({ applicationStatus: 'approved', b2bRole: 'b2b_manager', profile: { discountPercent: 12.5, creditTermsDays: 30, creditLimitAed: 20000 } });
    expect(approved.roles).toEqual(expect.arrayContaining(['customer', 'b2b_manager']));
    expect(approved.roles).not.toContain('b2b_owner');
    expect(approved.reviewedBy).toBeTruthy();

    const updated = await (await request.patch(`admin/partners/${ids.bob}`, { data: { role: 'b2b_owner', discountPercent: 15 }, headers: admin })).json();
    expect(updated).toMatchObject({ b2bRole: 'b2b_owner', profile: { discountPercent: 15, creditTermsDays: 30 } });
    const detail = await (await request.get(`admin/partners/${ids.bob}`, { headers: admin })).json();
    expect(detail.bookings).toEqual([]);
    const asCustomer = await (await request.get('admin/customers', { headers: admin, params: { q: emails.bob, b2b: 'true' } })).json();
    expect(asCustomer.items[0]).toMatchObject({ isB2B: true });
    // a staff member without partners.* cannot see them
    expect((await request.get(`admin/partners/${ids.bob}`, { headers: await auth('support') })).status()).toBe(403);
    const csv = await request.get('admin/partners/export.csv', { headers: admin, params: { q: emails.bob } });
    expect((await csv.text()).startsWith('﻿Company,Contact,Email')).toBe(true);
  });
});
