import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { type ClerkClient, createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import mongoose from 'mongoose';

const ADMIN_ROUTES = [
  ['get', 'admin/me'],
  ['get', 'admin/summary'],
  ['get', 'admin/audit'],
  ['get', 'admin/staff'],
  ['post', 'admin/staff'],
  ['patch', 'admin/staff/665f1c2b9a1e4b0012345678'],
  ['post', 'admin/staff/665f1c2b9a1e4b0012345678/deactivate'],
  ['post', 'admin/staff/665f1c2b9a1e4b0012345678/reactivate'],
  ['get', 'admin/settings/commerce'],
  ['put', 'admin/settings/commerce'],
] as const;

test.describe('admin platform (anonymous)', () => {
  test('every admin route answers 401 without a token and with a bad token', async ({ request }) => {
    for (const [method, path] of ADMIN_ROUTES) {
      const anonymous = await request[method](path, {
        data: method === 'get' ? undefined : {},
      });
      expect(anonymous.status(), `${method} ${path} without token`).toBe(401);
      const bad = await request[method](path, {
        data: method === 'get' ? undefined : {},
        headers: { Authorization: 'Bearer garbage' },
      });
      expect(bad.status(), `${method} ${path} with bad token`).toBe(401);
    }
  });

  test('audit entries cannot be modified or deleted through the API', async ({ request }) => {
    for (const method of ['put', 'patch', 'delete'] as const) {
      const response = await request[method]('admin/audit/665f1c2b9a1e4b0012345678', { data: {} });
      expect([401, 404], `${method} admin/audit/:id`).toContain(response.status());
    }
  });

  test('GET /settings/public is public, cacheable and exposes only safe fields', async ({ request }) => {
    const response = await request.get('settings/public');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=60');
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['siteName', 'socials', 'supportEmail', 'supportPhone']);
    expect(typeof body.siteName).toBe('string');
    expect(typeof body.socials).toBe('object');
  });
});

function clerkTestSecretKey(): string | undefined {
  let key = process.env.CLERK_SECRET_KEY;
  const envFile = resolve(process.cwd(), '.env');
  if (!key && existsSync(envFile)) key = parseEnv(readFileSync(envFile, 'utf8')).CLERK_SECRET_KEY;
  return key?.startsWith('sk_test_') ? key : undefined;
}

/**
 * Real Clerk development tokens for throwaway users. The staff records are inserted straight into
 * MongoDB (MONGODB_URI, defaulting to the Playwright test database), so the API under test must use
 * the same database; otherwise the staff tests skip. Everything created is removed afterwards.
 */
test.describe('admin platform (Clerk-authenticated)', () => {
  const secretKey = clerkTestSecretKey();
  test.skip(!secretKey, 'CLERK_SECRET_KEY for a Clerk development instance (sk_test_...) is not set');
  test.describe.configure({ mode: 'serial' });

  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/tourvex_test';
  const stamp = Date.now();
  const emails = {
    customer: `adm-customer-${stamp}+clerk_test@example.com`,
    owner: `adm-owner-${stamp}+clerk_test@example.com`,
    staff: `adm-staff-${stamp}+clerk_test@example.com`,
  };
  const clerkIds: string[] = [];
  const sessions: Record<string, string> = {};
  let clerk: ClerkClient;
  let connection: mongoose.Connection;
  let ownerId: string;
  let staffId: string;

  async function headers(who: keyof typeof emails) {
    const { jwt } = await clerk.sessions.getToken(sessions[who]);
    return { Authorization: `Bearer ${jwt}` };
  }

  async function createClerkUser(who: keyof typeof emails) {
    const user = await clerk.users.createUser({
      emailAddress: [emails[who]],
      username: `adm_test_${randomBytes(6).toString('hex')}`,
      password: `${randomBytes(18).toString('base64url')}-Aa1!`,
      firstName: 'Admin',
      lastName: `Tester ${who}`,
      skipPasswordChecks: true,
    });
    clerkIds.push(user.id);
    sessions[who] = (await clerk.sessions.createSession({ userId: user.id })).id;
  }

  test.beforeAll(async () => {
    clerk = createClerkClient({ secretKey });
    connection = await mongoose.createConnection(mongoUri).asPromise();
    const users = connection.collection('users');
    const owner = await users.insertOne({
      firstName: 'Owner',
      lastName: 'Tester',
      email: emails.owner,
      roles: ['customer', 'super_admin'],
      status: 'active',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ownerId = owner.insertedId.toString();
    await createClerkUser('customer');
    await createClerkUser('owner');
    await createClerkUser('staff');
  });

  test.afterAll(async () => {
    for (const id of clerkIds) await clerk.users.deleteUser(id).catch(() => undefined);
    if (connection) {
      const users = connection.collection('users');
      const created = await users
        .find({ email: { $in: Object.values(emails) } }, { projection: { _id: 1 } })
        .toArray();
      const ids = created.map((user) => user._id);
      await connection.collection('audit_logs').deleteMany({
        $or: [{ actorId: { $in: ids } }, { entityId: { $in: ids.map(String) } }],
      });
      await users.deleteMany({ email: { $in: Object.values(emails) } });
      await connection.close();
    }
  });

  let azpEnforced: boolean | undefined;
  test.beforeEach(async ({ request }) => {
    azpEnforced ??=
      (await request.get('auth/me', { headers: await headers('customer') })).status() === 401;
    test.skip(
      azpEnforced,
      'The API under test enforces the Clerk azp claim; run it with NODE_ENV=test and CLERK_AUTHORIZED_PARTIES=*',
    );
  });

  test('a customer gets 403 on every admin route', async ({ request }) => {
    const auth = await headers('customer');
    for (const [method, path] of ADMIN_ROUTES) {
      const response = await request[method](path, {
        data: method === 'get' ? undefined : {},
        headers: auth,
      });
      expect(response.status(), `${method} ${path} as customer`).toBe(403);
    }
  });

  test('a super admin gets the profile, permissions and server-built menu', async ({ request }) => {
    const response = await request.get('admin/me', { headers: await headers('owner') });
    test.skip(
      response.status() === 403,
      'The API under test uses a different database than MONGODB_URI, so the seeded staff user was not found',
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const me = await response.json();
    expect(me.user).toMatchObject({ id: ownerId, email: emails.owner });
    expect(me.user.roles).toEqual(expect.arrayContaining(['super_admin']));
    expect(me.permissions).toEqual(
      expect.arrayContaining(['staff.assign_super_admin', 'audit.read', 'settings.write']),
    );
    expect(me.menu.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(['dashboard', 'staff', 'audit', 'settings']),
    );
    for (const item of me.menu) {
      expect(Object.keys(item)).toEqual(expect.arrayContaining(['id', 'label', 'href', 'icon']));
    }
  });

  test('GET /admin/summary returns counts', async ({ request }) => {
    const response = await request.get('admin/summary', { headers: await headers('owner') });
    expect(response.status()).toBe(200);
    const body = await response.json();
    for (const value of [
      body.bookings.today,
      body.bookings.pending,
      body.enquiries.open,
      body.tickets.open,
      body.customers.new7d,
    ]) {
      expect(Number.isInteger(value) && value >= 0).toBeTruthy();
    }
  });

  test('staff management validates, creates, edits, lists and protects', async ({ request }) => {
    const auth = await headers('owner');

    const invalid = await request.post('admin/staff', {
      data: { email: emails.staff, fullName: 'Pat Support', roles: ['customer'] },
      headers: auth,
    });
    expect(invalid.status()).toBe(400);

    const created = await request.post('admin/staff', {
      data: { email: emails.staff, fullName: 'Pat Support', roles: ['support'] },
      headers: auth,
    });
    expect(created.status()).toBe(201);
    const staff = await created.json();
    staffId = staff.id;
    expect(staff).toMatchObject({
      email: emails.staff,
      fullName: 'Pat Support',
      active: true,
      linkedToClerk: false,
    });
    expect(staff.roles).toEqual(expect.arrayContaining(['support']));

    const listed = await (
      await request.get(`admin/staff?q=${encodeURIComponent(emails.staff)}&role=support`, { headers: auth })
    ).json();
    expect(listed.items.map((item: { id: string }) => item.id)).toEqual([staffId]);
    expect(listed.pagination).toMatchObject({ page: 1, limit: 20, total: 1, pages: 1 });
    expect((await request.get('admin/staff?limit=101', { headers: auth })).status()).toBe(400);
    expect((await request.get('admin/staff?sort=passwordHash:asc', { headers: auth })).status()).toBe(400);

    const own = await request.patch(`admin/staff/${ownerId}`, {
      data: { roles: ['admin'] },
      headers: auth,
    });
    expect(own.status()).toBe(403);
    await expect(own.json()).resolves.toMatchObject({ code: 'SELF_ROLE_CHANGE' });
    const selfOff = await request.post(`admin/staff/${ownerId}/deactivate`, { headers: auth });
    expect(selfOff.status()).toBe(403);

    const patched = await request.patch(`admin/staff/${staffId}`, {
      data: { roles: ['support', 'sales'], fullName: 'Pat Q Support' },
      headers: auth,
    });
    expect(patched.status()).toBe(200);
    await expect(patched.json()).resolves.toMatchObject({
      fullName: 'Pat Q Support',
      lastName: 'Q Support',
    });
    expect((await request.patch(`admin/staff/${staffId}`, { data: {}, headers: auth })).status()).toBe(400);
    expect(
      (await request.patch(`admin/staff/${staffId}`, { data: { roles: ['root'] }, headers: auth })).status(),
    ).toBe(400);
    // Customers are not staff: an unknown or non-staff id is a 404.
    expect(
      (await request.get('admin/staff/665f1c2b9a1e4b0012345678', { headers: auth })).status(),
    ).toBe(404);
  });

  test('a limited staff role gets only what it holds, and deactivation blocks everything', async ({ request }) => {
    const staffAuth = await headers('staff');
    const first = await request.get('admin/me', { headers: staffAuth });
    expect(first.status()).toBe(200);
    const me = await first.json();
    expect(me.user.id).toBe(staffId);
    expect(me.permissions).toContain('tickets.write');
    expect(me.permissions).not.toContain('staff.read');
    // support + sales: dashboard comes from sales.
    expect(me.menu.map((item: { id: string }) => item.id)).toEqual(['dashboard']);

    expect((await request.get('admin/summary', { headers: await headers('staff') })).status()).toBe(200);
    for (const [method, path] of [
      ['get', 'admin/audit'],
      ['get', 'admin/staff'],
      ['get', 'admin/settings/commerce'],
    ] as const) {
      expect((await request[method](path, { headers: await headers('staff') })).status(), path).toBe(403);
    }

    const owner = await headers('owner');
    const off = await request.post(`admin/staff/${staffId}/deactivate`, { headers: owner });
    expect(off.status()).toBe(201);
    await expect(off.json()).resolves.toMatchObject({ id: staffId, active: false });
    for (const path of ['admin/me', 'admin/summary', 'auth/me']) {
      const blocked = await request.get(path, { headers: await headers('staff') });
      expect(blocked.status(), `${path} after deactivation`).toBe(403);
    }
    const inactive = await (
      await request.get('admin/staff?status=inactive&limit=100', { headers: owner })
    ).json();
    expect(inactive.items.map((item: { id: string }) => item.id)).toContain(staffId);

    const on = await request.post(`admin/staff/${staffId}/reactivate`, { headers: owner });
    expect(on.status()).toBe(201);
    expect((await request.get('admin/me', { headers: await headers('staff') })).status()).toBe(200);
  });

  test('settings: read, validation errors and unknown groups', async ({ request }) => {
    const auth = await headers('owner');
    const view = await request.get('admin/settings/commerce', { headers: auth });
    expect(view.status()).toBe(200);
    const body = await view.json();
    expect(body.group).toBe('commerce');
    expect(Object.keys(body.values).sort()).toEqual(
      ['bookingCutoffHours', 'fxMarkupPercent', 'holdMinutes', 'taxPercent'],
    );

    const invalid = await request.put('admin/settings/commerce', {
      data: { taxPercent: 99, holdMinutes: 10, fxMarkupPercent: 0, bookingCutoffHours: 0 },
      headers: auth,
    });
    expect(invalid.status()).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await request.get('admin/settings/nope', { headers: auth })).status()).toBe(404);
    expect(
      (await request.put('admin/settings/general', { data: { siteName: 'x', supportEmail: 'bad' }, headers: auth })).status(),
    ).toBe(400);
  });

  test('the audit log recorded the changes, without raw IPs, and is read-only', async ({ request }) => {
    const auth = await headers('owner');
    const response = await request.get(`admin/audit?entityId=${staffId}&limit=50`, { headers: auth });
    expect(response.status()).toBe(200);
    const { items, pagination } = await response.json();
    const actions = items.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(['staff.create', 'staff.update', 'staff.deactivate', 'staff.reactivate']),
    );
    expect(pagination.total).toBeGreaterThanOrEqual(4);
    // Newest first.
    const times = items.map((entry: { at: string }) => Date.parse(entry.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    for (const entry of items) {
      expect(entry).toMatchObject({ actorId: ownerId, actorEmail: emails.owner, entityType: 'staff' });
      expect(entry).not.toHaveProperty('ip');
    }
    const update = items.find((entry: { action: string }) => entry.action === 'staff.update');
    expect(update.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'fullName', to: 'Pat Q Support' })]),
    );

    const filtered = await (
      await request.get(`admin/audit?action=staff.deactivate&actor=${ownerId}&entityId=${staffId}`, { headers: auth })
    ).json();
    expect(filtered.items).toHaveLength(1);
    expect((await request.get('admin/audit?from=not-a-date', { headers: auth })).status()).toBe(400);
  });
});
