import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { type ClerkClient, createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import mongoose from 'mongoose';

test('health and public platform settings are available', async ({ request }) => {
  const health = await request.get('health');
  expect(health.ok()).toBeTruthy();
  await expect(health.json()).resolves.toMatchObject({ service: 'tourvex-api', database: 'up' });

  const settings = await request.get('platform/settings');
  expect(settings.ok()).toBeTruthy();
  const payload = await settings.json();
  expect(payload.locales).toEqual(['en', 'ar']);
  expect(payload.currencies).toContain('AED');
});

test('all five supplier verticals return mock inventory', async ({ request }) => {
  for (const serviceType of ['flight', 'hotel', 'activity', 'visa', 'transfer']) {
    const response = await request.post('suppliers/search', {
      data: {
        serviceType,
        destination: 'Dubai',
        startDate: '2026-12-10T00:00:00.000Z',
        travelers: 2,
        currency: 'AED',
      },
    });
    expect(response.ok()).toBeTruthy();
    const offers = await response.json();
    expect(offers).toHaveLength(5);
    expect(offers[0]).toMatchObject({ serviceType, supplier: 'tourvex-mock-supplier' });
  }
});

test.describe('holidays', () => {
  test('home returns banners, cities, countries and collections', async ({ request }) => {
    const response = await request.get('holidays/home');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    for (const key of ['banners', 'cities', 'countries', 'collections']) {
      expect(Array.isArray(body[key])).toBeTruthy();
    }
    expect(body.currency).toBe('AED');
  });

  test('list paginates and filters', async ({ request }) => {
    const response = await request.get('holidays?limit=2&page=1&sort=price_asc');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
    expect(body.pagination).toMatchObject({ page: 1, limit: 2 });
    expect(Array.isArray(body.facets.destinations)).toBeTruthy();

    const unknown = await request.get('holidays?destination=Nowhere-Land');
    expect(unknown.ok()).toBeTruthy();
    await expect(unknown.json()).resolves.toMatchObject({ items: [], pagination: { total: 0 } });

    const tooMany = await request.get('holidays?limit=999');
    expect(tooMany.status()).toBe(400);

    if (body.items.length > 0) {
      const destination = body.items[0].destinations[0];
      const filtered = await (
        await request.get(`holidays?destination=${encodeURIComponent(destination)}`)
      ).json();
      expect(filtered.items.length).toBeGreaterThan(0);
      for (const item of filtered.items) expect(item.destinations).toContain(destination);
    }
  });

  test('detail returns 200 for a listed package and 404 otherwise', async ({ request }) => {
    const list = await (await request.get('holidays?limit=1')).json();
    if (list.items.length > 0) {
      const detail = await request.get(`holidays/${list.items[0].slug}`);
      expect(detail.status()).toBe(200);
      const body = await detail.json();
      expect(body.package.slug).toBe(list.items[0].slug);
      expect(Array.isArray(body.related)).toBeTruthy();
    }
    const missing = await request.get('holidays/does-not-exist-anywhere');
    expect(missing.status()).toBe(404);
  });
});

test.describe('visas', () => {
  test('home returns banners and non-empty sections', async ({ request }) => {
    const response = await request.get('visas/home');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(Array.isArray(body.banners)).toBeTruthy();
    expect(Array.isArray(body.sections)).toBeTruthy();
    for (const section of body.sections) expect(section.items.length).toBeGreaterThan(0);
    expect(body.currency).toBe('AED');
  });

  test('list paginates, filters and validates', async ({ request }) => {
    const response = await request.get('visas?limit=2&page=1&sort=price_asc');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
    expect(body.pagination).toMatchObject({ page: 1, limit: 2 });
    expect(Array.isArray(body.facets.kinds)).toBeTruthy();

    const unknown = await request.get('visas?q=zzz-no-such-country');
    expect(unknown.ok()).toBeTruthy();
    await expect(unknown.json()).resolves.toMatchObject({ items: [], pagination: { total: 0 } });

    expect((await request.get('visas?limit=999')).status()).toBe(400);
    expect((await request.get('visas?sort=bogus')).status()).toBe(400);
    expect((await request.get('visas?kind=bogus')).status()).toBe(400);

    if (body.items.length > 0) {
      const kind = body.items[0].kind;
      const filtered = await (await request.get(`visas?kind=${kind}`)).json();
      for (const item of filtered.items) expect(item.kind).toBe(kind);
    }
  });

  test('detail returns 200 for a listed visa and 404 otherwise', async ({ request }) => {
    const list = await (await request.get('visas?limit=1')).json();
    if (list.items.length > 0) {
      const detail = await request.get(`visas/${list.items[0].slug}`);
      expect(detail.status()).toBe(200);
      const body = await detail.json();
      expect(body.visa.slug).toBe(list.items[0].slug);
      expect(Array.isArray(body.visa.steps)).toBeTruthy();
      expect(Array.isArray(body.related)).toBeTruthy();
    }
    const missing = await request.get('visas/does-not-exist-anywhere');
    expect(missing.status()).toBe(404);
  });

  test('admin endpoints reject anonymous callers with 401', async ({ request }) => {
    for (const [method, path] of [
      ['get', 'visas/admin/all'],
      ['get', 'visas/enquiries/admin'],
      ['patch', 'visas/enquiries/665f1c2b9a1e4b0012345678'],
      ['post', 'visas'],
    ] as const) {
      const response = await request[method](path, { data: method === 'get' ? undefined : {} });
      expect(response.status(), `${method} ${path} without token`).toBe(401);
    }
  });
});

/**
 * Enquiry tests share the per-IP throttle (5 per minute) with each other, so they run serially and
 * the rate-limit test goes last. If a previous run used up the window, the suite skips instead of
 * failing; wait a minute and re-run.
 */
test.describe('visa enquiries', () => {
  test.describe.configure({ mode: 'serial' });

  const enquiry = {
    fullName: 'Playwright Test',
    email: 'playwright-visa@example.com',
    phone: '+971 50 123 4567',
    nationality: 'Indian',
    travellers: 2,
    consent: true,
  };
  let slug: string | undefined;
  const created: string[] = [];

  test.beforeAll(async ({ request }) => {
    const list = await (await request.get('visas?limit=1')).json();
    slug = list.items?.[0]?.slug;
  });

  test.afterAll(async () => {
    if (created.length === 0) return;
    // Best-effort cleanup of the test documents by reference (the API has no delete endpoint).
    let uri = process.env.MONGODB_URI;
    const envFile = resolve(process.cwd(), '.env');
    if (!uri && existsSync(envFile)) uri = parseEnv(readFileSync(envFile, 'utf8')).MONGODB_URI;
    if (!uri) return;
    const connection = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
      .asPromise()
      .catch(() => undefined);
    if (!connection) return;
    try {
      await connection.collection('visa_enquiries').deleteMany({ reference: { $in: created } });
    } finally {
      await connection.close();
    }
  });

  test('a valid enquiry returns 201 with a VQ- reference and no personal data', async ({
    request,
  }) => {
    test.skip(!slug, 'No visas are published (run npm run seed:visas)');
    const response = await request.post(`visas/${slug}/enquiries`, {
      data: { ...enquiry, travelDate: '2099-01-15', message: 'Automated test enquiry' },
      // An invalid bearer token must be ignored, not rejected, on this public route.
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    test.skip(response.status() === 429, 'Throttle window used by a previous run; retry in a minute');
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['id', 'reference', 'status']);
    expect(body.reference).toMatch(/^VQ-[A-Z2-7]{8}$/);
    expect(body.status).toBe('new');
    created.push(body.reference);
  });

  test('missing consent and an unknown visa are rejected', async ({ request }) => {
    test.skip(!slug, 'No visas are published (run npm run seed:visas)');
    const noConsent = await request.post(`visas/${slug}/enquiries`, {
      data: { ...enquiry, consent: false },
    });
    test.skip(noConsent.status() === 429, 'Throttle window used by a previous run; retry in a minute');
    expect(noConsent.status()).toBe(400);

    const unknown = await request.post('visas/does-not-exist-anywhere/enquiries', { data: enquiry });
    expect(unknown.status()).toBe(404);
  });

  test('the sixth rapid enquiry request in a minute gets 429', async ({ request }) => {
    test.skip(!slug, 'No visas are published (run npm run seed:visas)');
    // Invalid bodies (consent false) never create data, and the throttle counts every request.
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const response = await request.post(`visas/${slug}/enquiries`, {
        data: { ...enquiry, consent: false },
      });
      statuses.push(response.status());
    }
    expect(statuses).toContain(429);
    expect(statuses.every((status) => status === 400 || status === 429)).toBeTruthy();
  });
});

const todayIso = () => new Date().toISOString().slice(0, 10);

test.describe('cruises', () => {
  test('home returns banners, cities, sections and lines with upcoming departures only', async ({
    request,
  }) => {
    const response = await request.get('cruises/home');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    for (const key of ['banners', 'cities', 'sections', 'lines']) {
      expect(Array.isArray(body[key])).toBeTruthy();
    }
    expect(body.currency).toBe('AED');
    expect(body.sections.length).toBeLessThanOrEqual(4);
    for (const section of body.sections) {
      expect(section.title).toBe(`Best sellers from ${section.city}`);
      expect(section.items.length).toBeGreaterThan(0);
      expect(section.items.length).toBeLessThanOrEqual(12);
      for (const item of section.items) {
        expect(item.nextDepartures.length).toBeGreaterThan(0);
        for (const date of item.nextDepartures) expect(date >= todayIso()).toBeTruthy();
      }
    }
    for (const city of body.cities) expect(city.count).toBeGreaterThan(0);
  });

  test('list paginates, filters, exposes facets and validates input', async ({ request }) => {
    const response = await request.get('cruises?limit=2&page=1&sort=price_asc');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
    expect(body.pagination).toMatchObject({ page: 1, limit: 2 });
    for (const facet of ['cities', 'lines', 'regions', 'months']) {
      expect(Array.isArray(body.facets[facet])).toBeTruthy();
    }
    for (const item of body.items) {
      expect(item.nextDepartures.length).toBeLessThanOrEqual(4);
      expect(item.ports.length).toBeLessThanOrEqual(6);
    }

    const unknown = await request.get('cruises?city=Nowhere-Land');
    expect(unknown.ok()).toBeTruthy();
    await expect(unknown.json()).resolves.toMatchObject({ items: [], pagination: { total: 0 } });

    expect((await request.get('cruises?limit=999')).status()).toBe(400);
    expect((await request.get('cruises?sort=bogus')).status()).toBe(400);
    expect((await request.get('cruises?month=2026-13')).status()).toBe(400);
    expect((await request.get('cruises?month=nov')).status()).toBe(400);
    expect((await request.get('cruises?minNights=abc')).status()).toBe(400);

    if (body.items.length > 0) {
      const city = body.facets.cities[0].name;
      const byCity = await (await request.get(`cruises?city=${encodeURIComponent(city)}`)).json();
      expect(byCity.items.length).toBeGreaterThan(0);
      for (const item of byCity.items) expect(item.departureCity).toBe(city);

      const month = body.facets.months[0].name;
      const byMonth = await (await request.get(`cruises?month=${month}&limit=48`)).json();
      expect(byMonth.items.length).toBeGreaterThan(0);
      for (const item of byMonth.items) {
        expect(item.nextDepartures.some((d: string) => d.startsWith(month))).toBeTruthy();
      }

      const soonest = await (await request.get('cruises?sort=soonest&limit=48')).json();
      const firsts: string[] = soonest.items.map((i: { nextDepartures: string[] }) => i.nextDepartures[0]);
      expect([...firsts].sort()).toEqual(firsts);

      const priced = await (await request.get('cruises?sort=price_asc&limit=48')).json();
      const amounts: number[] = priced.items
        .filter((i: { price: unknown }) => i.price)
        .map((i: { price: { amount: number } }) => i.price.amount);
      expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
    }
  });

  test('detail returns 200 for a listed cruise and 404 otherwise', async ({ request }) => {
    const list = await (await request.get('cruises?limit=1')).json();
    if (list.items.length > 0) {
      const detail = await request.get(`cruises/${list.items[0].slug}`);
      expect(detail.status()).toBe(200);
      const body = await detail.json();
      expect(body.cruise.slug).toBe(list.items[0].slug);
      expect(body.cruise.itinerary).toHaveLength(body.cruise.durationDays);
      expect(body.cruise.departures.length).toBeGreaterThan(0);
      for (const date of body.cruise.departures) expect(date >= todayIso()).toBeTruthy();
      expect(Array.isArray(body.related)).toBeTruthy();
      expect(body.related.length).toBeLessThanOrEqual(6);
      expect(body.related.map((r: { slug: string }) => r.slug)).not.toContain(body.cruise.slug);
    }
    const missing = await request.get('cruises/does-not-exist-anywhere');
    expect(missing.status()).toBe(404);
  });

  test('admin endpoints reject anonymous callers with 401', async ({ request }) => {
    for (const [method, path] of [
      ['get', 'cruises/admin/all'],
      ['get', 'cruises/enquiries/admin'],
      ['patch', 'cruises/enquiries/665f1c2b9a1e4b0012345678'],
      ['post', 'cruises'],
      ['patch', 'cruises/665f1c2b9a1e4b0012345678'],
      ['delete', 'cruises/665f1c2b9a1e4b0012345678'],
    ] as const) {
      const response = await request[method](path, { data: method === 'get' ? undefined : {} });
      expect(response.status(), `${method} ${path} without token`).toBe(401);
    }
  });
});

/** Same throttle caveat as the visa enquiries: serial, and skipped when the window is used up. */
test.describe('cruise enquiries', () => {
  test.describe.configure({ mode: 'serial' });

  const enquiry = {
    fullName: 'Playwright Test',
    email: 'playwright-cruise@example.com',
    phone: '+971 50 123 4567',
    nationality: 'Indian',
    adults: 2,
    children: 1,
    consent: true,
  };
  let slug: string | undefined;
  let departure: string | undefined;
  const created: string[] = [];

  test.beforeAll(async ({ request }) => {
    const list = await (await request.get('cruises?limit=1')).json();
    slug = list.items?.[0]?.slug;
    if (slug) {
      const detail = await (await request.get(`cruises/${slug}`)).json();
      departure = detail.cruise?.departures?.[0];
    }
  });

  test.afterAll(async () => {
    if (created.length === 0) return;
    // Best-effort cleanup of the test documents by reference (the API has no delete endpoint).
    let uri = process.env.MONGODB_URI;
    const envFile = resolve(process.cwd(), '.env');
    if (!uri && existsSync(envFile)) uri = parseEnv(readFileSync(envFile, 'utf8')).MONGODB_URI;
    if (!uri) return;
    const connection = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
      .asPromise()
      .catch(() => undefined);
    if (!connection) return;
    try {
      await connection.collection('cruise_enquiries').deleteMany({ reference: { $in: created } });
    } finally {
      await connection.close();
    }
  });

  test('a valid enquiry returns 201 with a CQ- reference and no personal data', async ({ request }) => {
    test.skip(!slug || !departure, 'No cruises with upcoming departures (run npm run seed:cruises)');
    const response = await request.post(`cruises/${slug}/enquiries`, {
      data: {
        ...enquiry,
        departureDate: departure,
        cabinType: 'Balcony',
        message: 'Automated test enquiry',
      },
      // An invalid bearer token must be ignored, not rejected, on this public route.
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    test.skip(response.status() === 429, 'Throttle window used by a previous run; retry in a minute');
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['id', 'reference', 'status']);
    expect(body.reference).toMatch(/^CQ-[A-Z2-7]{8}$/);
    expect(body.status).toBe('new');
    created.push(body.reference);
  });

  test('missing consent, a bad departureDate and an unknown cruise are rejected', async ({ request }) => {
    test.skip(!slug, 'No cruises are published (run npm run seed:cruises)');
    const noConsent = await request.post(`cruises/${slug}/enquiries`, {
      data: { ...enquiry, consent: false },
    });
    test.skip(noConsent.status() === 429, 'Throttle window used by a previous run; retry in a minute');
    expect(noConsent.status()).toBe(400);

    const badDate = await request.post(`cruises/${slug}/enquiries`, {
      data: { ...enquiry, departureDate: '2099-01-15' },
    });
    expect(badDate.status()).toBe(400);

    const unknown = await request.post('cruises/does-not-exist-anywhere/enquiries', { data: enquiry });
    expect(unknown.status()).toBe(404);
  });
});

test.describe('events', () => {
  type EventCardBody = {
    slug: string;
    city: string;
    category: string;
    nextDate: string | null;
    price: { amount: number } | null;
  };

  test('home returns banners, categories, cities and sections with upcoming events only', async ({
    request,
  }) => {
    const response = await request.get('events/home');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    for (const key of ['banners', 'categories', 'cities', 'sections']) {
      expect(Array.isArray(body[key])).toBeTruthy();
    }
    expect(body.currency).toBe('AED');
    for (const category of body.categories) {
      expect(category.slug).toBe(category.name.toLowerCase());
    }
    for (const section of body.sections) {
      expect(section.items.length).toBeGreaterThan(0);
      expect(section.items.length).toBeLessThanOrEqual(12);
      for (const item of section.items as EventCardBody[]) {
        expect(item.nextDate && item.nextDate.slice(0, 10) >= todayIso()).toBeTruthy();
      }
    }
    if (body.sections.length > 0) expect(body.sections[0].slug).toBe('happening-soon');
  });

  test('list paginates, sorts and filters; bad input gives 400', async ({ request }) => {
    const response = await request.get('events?limit=2&page=1&sort=price_asc');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
    expect(body.pagination).toMatchObject({ page: 1, limit: 2 });
    for (const key of ['cities', 'categories', 'months']) expect(Array.isArray(body.facets[key])).toBeTruthy();

    const unknown = await request.get('events?city=Nowhere-Land');
    expect(unknown.ok()).toBeTruthy();
    await expect(unknown.json()).resolves.toMatchObject({ items: [], pagination: { total: 0 } });

    for (const query of ['limit=999', 'sort=bogus', 'date=2026-13-45', 'from=nope', 'to=2026-02-30', 'page=0']) {
      expect((await request.get(`events?${query}`)).status(), query).toBe(400);
    }

    const { facets } = body;
    if (facets.cities.length > 0 && facets.categories.length > 0) {
      const city = facets.cities[0].name as string;
      const byCity = await (await request.get(`events?city=${encodeURIComponent(city)}&limit=48`)).json();
      expect(byCity.items.length).toBeGreaterThan(0);
      for (const item of byCity.items as EventCardBody[]) expect(item.city).toBe(city);

      const slug = facets.categories[0].slug as string;
      const byCategory = await (await request.get(`events?category=${slug}&limit=48`)).json();
      expect(byCategory.items.length).toBeGreaterThan(0);
      for (const item of byCategory.items as EventCardBody[]) {
        expect(item.category.toLowerCase()).toBe(slug);
      }

      const soonest = (await (await request.get('events?sort=soonest&limit=48')).json())
        .items as EventCardBody[];
      const dates = soonest.map((item) => item.nextDate as string);
      expect(dates).toEqual([...dates].sort());

      const priced = (await (await request.get('events?sort=price_asc&limit=48')).json())
        .items as EventCardBody[];
      const prices = priced.map((item) => item.price?.amount ?? Number.MAX_SAFE_INTEGER);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));

      const day = dates[0].slice(0, 10);
      const byDay = await (await request.get(`events?date=${day}&limit=48`)).json();
      expect(byDay.items.map((i: EventCardBody) => i.slug)).toContain(soonest[0].slug);
    }
  });

  test('USD currency conversion applies to the list', async ({ request }) => {
    const response = await request.get('events?limit=1&currency=USD');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    // Conversion is skipped (AED kept) only when no FX rate is cached yet.
    if (response.headers()['x-currency']) {
      expect(response.headers()['x-currency']).toBe('USD');
      expect(body.items[0].price.currency).toBe('USD');
    }
  });

  test('detail returns 200 for a listed event and 404 otherwise', async ({ request }) => {
    const list = await (await request.get('events?limit=1')).json();
    if (list.items?.length) {
      const detail = await request.get(`events/${list.items[0].slug}`);
      expect(detail.status()).toBe(200);
      const body = await detail.json();
      expect(body.event.slug).toBe(list.items[0].slug);
      expect(body.event.sessions.length).toBeGreaterThan(0);
      expect(body.event.sessions.length).toBeLessThanOrEqual(60);
      for (const session of body.event.sessions) {
        expect(session.startsAt.slice(0, 10) >= todayIso()).toBeTruthy();
      }
      expect(body.event.ticketTypes.length).toBeGreaterThanOrEqual(2);
      expect(body.event.ticketTypes.length).toBeLessThanOrEqual(4);
      expect(body.related.length).toBeLessThanOrEqual(6);
      expect(body.related.map((r: { slug: string }) => r.slug)).not.toContain(body.event.slug);
    }
    const missing = await request.get('events/does-not-exist-anywhere');
    expect(missing.status()).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ message: 'Event not found' });
  });

  test('admin and enquiry-management routes reject anonymous callers with 401', async ({ request }) => {
    for (const [method, path] of [
      ['get', 'events/admin/all'],
      ['get', 'events/enquiries/admin'],
      ['patch', 'events/enquiries/665f1c2b9a1e4b0012345678'],
      ['post', 'events'],
      ['patch', 'events/665f1c2b9a1e4b0012345678'],
      ['delete', 'events/665f1c2b9a1e4b0012345678'],
    ] as const) {
      const response = await request[method](path, { data: method === 'get' ? undefined : {} });
      expect(response.status(), `${method} ${path} without token`).toBe(401);
    }
  });
});

/** Same throttle caveat as the cruise enquiries: serial, and skipped when the window is used up. */
test.describe('event enquiries', () => {
  test.describe.configure({ mode: 'serial' });

  const enquiry = {
    fullName: 'Playwright Test',
    email: 'playwright-event@example.com',
    phone: '+971 50 123 4567',
    tickets: 2,
    consent: true,
  };
  let slug: string | undefined;
  let sessionId: string | undefined;
  const created: string[] = [];

  test.beforeAll(async ({ request }) => {
    const list = await (await request.get('events?limit=1')).json();
    slug = list.items?.[0]?.slug;
    if (slug) {
      const detail = await (await request.get(`events/${slug}`)).json();
      sessionId = detail.event?.sessions?.[0]?.id;
    }
  });

  test.afterAll(async () => {
    if (created.length === 0) return;
    // Best-effort cleanup of the test documents by reference (the API has no delete endpoint).
    let uri = process.env.MONGODB_URI;
    const envFile = resolve(process.cwd(), '.env');
    if (!uri && existsSync(envFile)) uri = parseEnv(readFileSync(envFile, 'utf8')).MONGODB_URI;
    if (!uri) return;
    const connection = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 3000 })
      .asPromise()
      .catch(() => undefined);
    if (!connection) return;
    try {
      await connection.collection('event_enquiries').deleteMany({ reference: { $in: created } });
    } finally {
      await connection.close();
    }
  });

  test('a valid enquiry returns 201 with an EQ- reference and no personal data', async ({ request }) => {
    test.skip(!slug || !sessionId, 'No events with upcoming sessions (run npm run seed:events)');
    const response = await request.post(`events/${slug}/enquiries`, {
      data: { ...enquiry, sessionId, ticketType: 'General Admission', message: 'Automated test enquiry' },
      // An invalid bearer token must be ignored, not rejected, on this public route.
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    test.skip(response.status() === 429, 'Throttle window used by a previous run; retry in a minute');
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['id', 'reference', 'status']);
    expect(body.reference).toMatch(/^EQ-[A-Z2-7]{8}$/);
    expect(body.status).toBe('new');
    created.push(body.reference);
  });

  test('missing consent, an unknown sessionId and an unknown event are rejected', async ({ request }) => {
    test.skip(!slug, 'No events are published (run npm run seed:events)');
    const noConsent = await request.post(`events/${slug}/enquiries`, {
      data: { ...enquiry, consent: false },
    });
    test.skip(noConsent.status() === 429, 'Throttle window used by a previous run; retry in a minute');
    expect(noConsent.status()).toBe(400);

    const badSession = await request.post(`events/${slug}/enquiries`, {
      data: { ...enquiry, sessionId: '665f1c2b9a1e4b0012345678' },
    });
    expect(badSession.status()).toBe(400);

    const unknown = await request.post('events/does-not-exist-anywhere/enquiries', { data: enquiry });
    expect(unknown.status()).toBe(404);
  });
});

test.describe('authentication (Clerk session tokens)', () => {
  test('protected routes reject missing and invalid tokens with 401', async ({ request }) => {
    for (const [method, path] of [
      ['get', 'auth/me'],
      ['post', 'users/me/partner-application'],
      ['post', 'holidays'],
      ['get', 'users'],
    ] as const) {
      const anonymous = await request[method](path, { data: method === 'post' ? {} : undefined });
      expect(anonymous.status(), `${method} ${path} without token`).toBe(401);
    }
    for (const token of ['garbage', 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2ln']) {
      const response = await request.get('auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status()).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ message: 'Authentication required' });
    }
  });

  test('legacy password endpoints are gone', async ({ request }) => {
    for (const path of ['auth/register', 'auth/login', 'auth/refresh', 'auth/logout']) {
      expect((await request.post(path, { data: {} })).status(), path).toBe(404);
    }
  });
});

/**
 * Real end-to-end tests against the Clerk DEVELOPMENT instance: a throwaway Clerk user is created
 * through the Backend API, a session token is minted for it and sent to our API, and the Clerk
 * user is deleted afterwards. Requires a `sk_test_` CLERK_SECRET_KEY (env or .env); never runs
 * against a production Clerk instance.
 */
function clerkTestSecretKey(): string | undefined {
  let key = process.env.CLERK_SECRET_KEY;
  const envFile = resolve(process.cwd(), '.env');
  if (!key && existsSync(envFile)) key = parseEnv(readFileSync(envFile, 'utf8')).CLERK_SECRET_KEY;
  return key?.startsWith('sk_test_') ? key : undefined;
}

test.describe('Clerk-authenticated customer', () => {
  const secretKey = clerkTestSecretKey();
  test.skip(
    !secretKey,
    'CLERK_SECRET_KEY for a Clerk development instance (sk_test_...) is not set',
  );
  test.describe.configure({ mode: 'serial' });

  let clerk: ClerkClient;
  let clerkUserId: string | undefined;
  let sessionId: string;
  const email = `api-test-${Date.now()}+clerk_test@example.com`;

  /** Clerk session tokens live ~60 s, so mint a fresh one per request batch. */
  async function authHeaders() {
    const { jwt } = await clerk.sessions.getToken(sessionId);
    return { Authorization: `Bearer ${jwt}` };
  }

  test.beforeAll(async () => {
    clerk = createClerkClient({ secretKey });
    const user = await clerk.users.createUser({
      emailAddress: [email],
      // The instance may require a username; harmless when it does not.
      username: `api_test_${randomBytes(6).toString('hex')}`,
      password: `${randomBytes(18).toString('base64url')}-Aa1!`,
      firstName: 'Api',
      lastName: 'Tester',
      skipPasswordChecks: true,
    });
    clerkUserId = user.id;
    sessionId = (await clerk.sessions.createSession({ userId: user.id })).id;
  });

  test.afterAll(async () => {
    if (clerkUserId) await clerk.users.deleteUser(clerkUserId);
  });

  // Backend-API-minted tokens carry no `azp` claim. A server that enforces authorized parties
  // (any server not started with NODE_ENV=test and CLERK_AUTHORIZED_PARTIES=*) rejects them.
  let azpEnforced: boolean | undefined;
  test.beforeEach(async ({ request }) => {
    azpEnforced ??=
      (await request.get('auth/me', { headers: await authHeaders() })).status() === 401;
    test.skip(
      azpEnforced,
      'The API under test enforces the Clerk azp claim; run it with NODE_ENV=test and CLERK_AUTHORIZED_PARTIES=* (as the Playwright webServer does) to exercise real Clerk tokens',
    );
  });

  test('GET /auth/me provisions and returns the local profile', async ({ request }) => {
    const response = await request.get('auth/me', { headers: await authHeaders() });
    expect(response.status()).toBe(200);
    const profile = await response.json();
    expect(profile).toMatchObject({
      clerkUserId,
      firstName: 'Api',
      lastName: 'Tester',
      email,
      roles: ['customer'],
      status: 'active',
      partnerApplication: null,
    });
    expect(profile.id).toMatch(/^[a-f0-9]{24}$/);

    const again = await request.get('auth/me', { headers: await authHeaders() });
    await expect(again.json()).resolves.toMatchObject({ id: profile.id });
  });

  test('a customer gets 403 on admin routes', async ({ request }) => {
    const headers = await authHeaders();
    expect((await request.post('holidays', { data: {}, headers })).status()).toBe(403);
    expect((await request.get('holidays/admin/all', { headers })).status()).toBe(403);
    expect((await request.get('users', { headers })).status()).toBe(403);
    const review = await request.patch('users/665f1c2b9a1e4b0012345678/partner-application', {
      data: { decision: 'approved' },
      headers,
    });
    expect(review.status()).toBe(403);
  });

  test('a customer can apply once to become a partner', async ({ request }) => {
    const headers = await authHeaders();
    const invalid = await request.post('users/me/partner-application', {
      data: { companyName: 'X', phone: 'call me', website: 'ftp://example.com' },
      headers,
    });
    expect(invalid.status()).toBe(400);

    const applied = await request.post('users/me/partner-application', {
      data: {
        companyName: 'Playwright Travel LLC',
        phone: '+971 4 123 4567',
        website: 'https://example.com',
        message: 'We sell desert safaris.',
      },
      headers,
    });
    expect(applied.status()).toBe(201);
    await expect(applied.json()).resolves.toMatchObject({
      email,
      roles: ['customer'],
      partnerApplication: {
        status: 'pending',
        companyName: 'Playwright Travel LLC',
        phone: '+971 4 123 4567',
        website: 'https://example.com',
      },
    });

    const duplicate = await request.post('users/me/partner-application', {
      data: { companyName: 'Playwright Travel LLC' },
      headers,
    });
    expect(duplicate.status()).toBe(409);
  });
});

test.describe('currency conversion', () => {
  async function loadRates(request: import('@playwright/test').APIRequestContext) {
    const response = await request.get('currency/rates');
    expect(response.ok()).toBeTruthy();
    return { response, body: await response.json() };
  }

  test('GET /currency/rates has the documented shape and is cacheable', async ({ request }) => {
    const { response, body } = await loadRates(request);
    expect(response.headers()['cache-control']).toBe('public, max-age=300');
    expect(body).toMatchObject({
      base: 'AED',
      source: 'ExchangeRate-API',
      attribution: 'Rates by ExchangeRate-API',
    });
    expect(typeof body.stale).toBe('boolean');
    expect(body.rates.AED).toBe(1);
    expect(body.currencies).toHaveLength(50);
    expect(body.currencies).toEqual(expect.arrayContaining(['AED', 'USD', 'JPY', 'ZAR']));
    for (const [code, rate] of Object.entries<number>(body.rates)) {
      expect(body.currencies).toContain(code);
      expect(Number.isFinite(rate) && rate > 0).toBeTruthy();
    }
  });

  test('holidays?currency=USD returns USD money matching AED amount x rate', async ({ request }) => {
    const { body: fx } = await loadRates(request);
    test.skip(!fx.rates.USD, 'No stored FX rates in this environment (refresh is disabled when NODE_ENV=test)');

    const aed = await (await request.get('holidays?limit=6')).json();
    const usdResponse = await request.get('holidays?limit=6&currency=usd');
    expect(usdResponse.ok()).toBeTruthy();
    expect(usdResponse.headers()['x-currency']).toBe('USD');
    const usd = await usdResponse.json();
    expect(usd.currency).toBe('USD');
    expect(usd.items).toHaveLength(aed.items.length);
    expect(aed.items.length).toBeGreaterThan(0);
    for (const [i, item] of usd.items.entries()) {
      expect(item.price.currency).toBe('USD');
      expect(Math.abs(item.price.amount - aed.items[i].price.amount * fx.rates.USD)).toBeLessThanOrEqual(0.0101);
    }
  });

  test('an unsupported currency is ignored and stays AED', async ({ request }) => {
    const response = await request.get('holidays?limit=2&currency=XYZ');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-currency']).toBeUndefined();
    const body = await response.json();
    expect(body.currency).toBe('AED');
    for (const item of body.items) expect(item.price.currency).toBe('AED');
  });

  test('bookings routes are unaffected by the currency param', async ({ request }) => {
    const response = await request.get('bookings?currency=USD');
    expect(response.status()).toBe(401);
    expect(response.headers()['x-currency']).toBeUndefined();
  });
});

test.describe('partners', () => {
  test('list returns the section title and well-formed items with cache headers', async ({ request }) => {
    const response = await request.get('partners');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=300');
    const body = await response.json();
    expect(body.title).toBe('In Partnership with World-Class Attractions');
    expect(typeof body.subtitle).toBe('string');
    expect(Array.isArray(body.items)).toBeTruthy();
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['category', 'href', 'id', 'logo', 'name']);
      expect(item.logo === null || /^(\/images\/|https:\/\/)/.test(item.logo)).toBeTruthy();
      expect(item.href === null || item.href.startsWith('https://')).toBeTruthy();
    }
  });

  test('placement and limit filters work and bad values are rejected', async ({ request }) => {
    for (const placement of ['home', 'activities']) {
      const response = await request.get(`partners?placement=${placement}&limit=3`);
      expect(response.status()).toBe(200);
      expect((await response.json()).items.length).toBeLessThanOrEqual(3);
    }
    expect((await request.get('partners?placement=bogus')).status()).toBe(400);
    expect((await request.get('partners?limit=49')).status()).toBe(400);
    expect((await request.get('partners?limit=0')).status()).toBe(400);
  });

  test('admin endpoints reject anonymous callers with 401', async ({ request }) => {
    const id = '665f1c2b9a1e4b0012345678';
    for (const [method, path] of [
      ['get', 'partners/admin/all'],
      ['post', 'partners'],
      ['patch', `partners/${id}`],
      ['delete', `partners/${id}`],
    ] as const) {
      const response = await request[method](path, {
        data: method === 'post' || method === 'patch' ? {} : undefined,
      });
      expect(response.status(), `${method} ${path} without token`).toBe(401);
    }
  });
});

/** The slug the seed (`npm run seed:activity-details`) enriches with a pick-up option and a child price. */
const SEEDED_ACTIVITY = 'dhow-cruise-dubai-marina';
const FAKE_OBJECT_ID = '665f1c2b9a1e4b0012345678';

type ApiRequest = import('@playwright/test').APIRequestContext;

interface DetailOption {
  id: string;
  pickupRequired: boolean;
  childPrice: { amount: number } | null;
  adultPrice: { amount: number };
  minPax: number;
  maxPax: number;
}

async function seededDetail(request: ApiRequest) {
  const response = await request.get(`catalog/activities/${SEEDED_ACTIVITY}`);
  if (response.status() !== 200) return null;
  const body = await response.json();
  return Array.isArray(body.options) && body.options.length > 0 ? body : null;
}

/** The n-th available date of an option across this and the next month. */
async function availableDate(request: ApiRequest, optionId: string, index = 0) {
  const now = new Date();
  const dates: string[] = [];
  for (const offset of [0, 1]) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
      .toISOString()
      .slice(0, 7);
    const response = await request.get(
      `catalog/activities/${SEEDED_ACTIVITY}/availability?optionId=${optionId}&month=${month}`,
    );
    const body = await response.json();
    for (const day of body.days) if (day.status === 'available') dates.push(day.date);
  }
  return dates[index];
}

test.describe('activity detail, availability and quote', () => {
  test('detail exposes options, a null/valid rating and the sample flag outside production', async ({ request }) => {
    const detail = await seededDetail(request);
    test.skip(!detail, 'No seeded activity details (run npm run seed:activity-details)');
    expect(detail.slug).toBe(SEEDED_ACTIVITY);
    expect(detail.rating === null || typeof detail.rating.average === 'number').toBeTruthy();
    for (const option of detail.options) {
      expect(option.id).toMatch(/^[a-z0-9-]+$/);
      expect(option.adultPrice).toMatchObject({ currency: 'AED' });
      expect(option.adultPrice.amount).toBeGreaterThan(0);
      expect(['sharing', 'private', 'none']).toContain(option.transferType);
      expect(Array.isArray(option.operatingWeekdays)).toBeTruthy();
      expect(typeof option.pickupRequired).toBe('boolean');
      expect(typeof option.refundable).toBe('boolean');
    }
    expect(detail.options.some((o: DetailOption) => o.pickupRequired)).toBeTruthy();
    expect(detail.detailsAreSample).toBe(true);
    expect(detail.gallery[0]).toMatchObject({ url: expect.any(String), alt: expect.any(String) });
  });

  test('the activity list stays light: no options or long text', async ({ request }) => {
    const list = await (await request.get('catalog/activities?limit=5')).json();
    expect(list.items.length).toBeGreaterThan(0);
    for (const item of list.items) {
      expect(item.options).toBeUndefined();
      expect(item.description).toBeUndefined();
    }
  });

  test('detail converts option prices with ?currency while AED stays authoritative', async ({ request }) => {
    const detail = await seededDetail(request);
    test.skip(!detail, 'No seeded activity details');
    const fx = await (await request.get('currency/rates')).json();
    test.skip(!fx.rates.USD, 'No stored FX rates in this environment');
    const usd = await (await request.get(`catalog/activities/${SEEDED_ACTIVITY}?currency=USD`)).json();
    expect(usd.options[0].adultPrice.currency).toBe('USD');
    expect(
      Math.abs(usd.options[0].adultPrice.amount - detail.options[0].adultPrice.amount * fx.rates.USD),
    ).toBeLessThan(0.02);
  });

  test('availability returns a status for every day of the month', async ({ request }) => {
    const detail = await seededDetail(request);
    test.skip(!detail, 'No seeded activity details');
    const optionId = detail.options[0].id;
    const month = new Date().toISOString().slice(0, 7);
    const response = await request.get(
      `catalog/activities/${SEEDED_ACTIVITY}/availability?optionId=${optionId}&month=${month}`,
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ optionId, month, currency: 'AED' });
    const [year, mon] = month.split('-').map(Number);
    expect(body.days).toHaveLength(new Date(Date.UTC(year, mon, 0)).getUTCDate());
    for (const day of body.days) {
      expect(['available', 'sold_out', 'non_operational', 'past']).toContain(day.status);
      if (day.status === 'available') expect(day.adultPrice.currency).toBe('AED');
      else expect(day.adultPrice).toBeUndefined();
    }
    if (body.nextAvailable) {
      expect(body.days.find((d: { date: string }) => d.date === body.nextAvailable).status).toBe('available');
    }
    // Two months back is entirely in the past.
    const old = new Date(Date.UTC(year, mon - 3, 1)).toISOString().slice(0, 7);
    const past = await (
      await request.get(`catalog/activities/${SEEDED_ACTIVITY}/availability?optionId=${optionId}&month=${old}`)
    ).json();
    expect(past.days.every((d: { status: string }) => d.status === 'past')).toBeTruthy();
    expect(past.nextAvailable).toBeUndefined();
  });

  test('availability validates month and option and returns 404 for unknown ones', async ({ request }) => {
    const detail = await seededDetail(request);
    test.skip(!detail, 'No seeded activity details');
    const base = `catalog/activities/${SEEDED_ACTIVITY}/availability`;
    const id = detail.options[0].id;
    expect((await request.get(`${base}?optionId=${id}&month=2026-13`)).status()).toBe(400);
    expect((await request.get(`${base}?optionId=${id}`)).status()).toBe(400);
    expect((await request.get(`${base}?month=2026-10`)).status()).toBe(400);
    expect((await request.get(`${base}?optionId=nope&month=2026-10`)).status()).toBe(404);
    expect(
      (await request.get('catalog/activities/no-such-activity/availability?optionId=a&month=2026-10')).status(),
    ).toBe(404);
  });

  test('quote prices adults and children server-side with taxes shown', async ({ request }) => {
    const detail = await seededDetail(request);
    test.skip(!detail, 'No seeded activity details');
    const option: DetailOption | undefined = detail.options.find((o: DetailOption) => o.childPrice);
    test.skip(!option, 'No option with a child price');
    const date = await availableDate(request, option!.id);
    test.skip(!date, 'No available date in the next two months');

    const response = await request.post(`catalog/activities/${SEEDED_ACTIVITY}/quote?currency=USD`, {
      data: { optionId: option!.id, date, adults: 2, children: 1 },
    });
    expect(response.status()).toBe(201);
    const quote = await response.json();
    expect(quote.currency).toBe('AED');
    expect(quote.lines).toHaveLength(2);
    expect(quote.subtotal.amount).toBeCloseTo(2 * option!.adultPrice.amount + option!.childPrice!.amount, 2);
    expect(quote.discount.amount).toBe(0);
    expect(quote.taxesAndFees.amount).toBeGreaterThan(0);
    expect(quote.total.amount).toBeCloseTo(
      quote.subtotal.amount - quote.discount.amount + quote.taxesAndFees.amount,
      2,
    );
    expect(typeof quote.refundable).toBe('boolean');
    if (quote.display) expect(quote.display).toMatchObject({ currency: 'USD', total: { currency: 'USD' } });
  });

  test('quote rejects invalid bodies and impossible requests with clear codes', async ({ request }) => {
    const detail = await seededDetail(request);
    test.skip(!detail, 'No seeded activity details');
    const option: DetailOption = detail.options[0];
    const date = await availableDate(request, option.id);
    test.skip(!date, 'No available date in the next two months');
    const url = `catalog/activities/${SEEDED_ACTIVITY}/quote`;

    const bad = await request.post(url, { data: { optionId: option.id, date: 'soon', adults: 0, children: -1 } });
    expect(bad.status()).toBe(400);
    const extra = await request.post(url, { data: { optionId: option.id, date, adults: 1, children: 0, total: 1 } });
    expect(extra.status()).toBe(400);

    const past = await request.post(url, { data: { optionId: option.id, date: '2020-01-01', adults: 1, children: 0 } });
    expect(past.status()).toBe(409);
    await expect(past.json()).resolves.toMatchObject({ code: 'DATE_UNAVAILABLE' });

    const tooMany = await request.post(url, {
      data: { optionId: option.id, date, adults: option.maxPax + 1, children: 0 },
    });
    expect(tooMany.status()).toBe(400);
    await expect(tooMany.json()).resolves.toMatchObject({ code: 'PAX_LIMIT' });

    const noChildren: DetailOption | undefined = detail.options.find((o: DetailOption) => !o.childPrice);
    const noChildDate = noChildren ? await availableDate(request, noChildren.id) : undefined;
    if (noChildren && noChildDate) {
      const child = await request.post(url, {
        data: { optionId: noChildren.id, date: noChildDate, adults: Math.max(1, noChildren.minPax), children: 1 },
      });
      expect(child.status()).toBe(400);
      await expect(child.json()).resolves.toMatchObject({ code: 'CHILD_NOT_ALLOWED' });
    }
    const unknown = await request.post(url, { data: { optionId: 'nope', date, adults: 1, children: 0 } });
    expect(unknown.status()).toBe(404);
  });
});

test.describe('checkout, reviews and admin routes need a token', () => {
  test('every checkout route answers 401 without a Clerk token', async ({ request }) => {
    const itemId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const routes: Array<['get' | 'post' | 'patch' | 'delete', string]> = [
      ['get', 'checkout/cart'],
      ['get', 'checkout/cart/status'],
      ['post', 'checkout/cart/items'],
      ['patch', `checkout/cart/items/${itemId}`],
      ['delete', `checkout/cart/items/${itemId}`],
      ['patch', `checkout/cart/items/${itemId}/pickup`],
      ['patch', `checkout/cart/items/${itemId}/additional`],
      ['patch', 'checkout/cart/customer'],
      ['post', 'checkout/cart/promo'],
      ['delete', 'checkout/cart/promo'],
      ['post', 'checkout/cart/pay'],
      ['get', `checkout/sessions/${FAKE_OBJECT_ID}`],
      ['get', `checkout/sessions/${FAKE_OBJECT_ID}/status`],
      ['get', 'checkout/promos'],
      ['post', 'checkout/promos'],
      ['patch', `checkout/promos/${FAKE_OBJECT_ID}`],
      ['delete', `checkout/promos/${FAKE_OBJECT_ID}`],
      ['get', 'bookings/order/OR-ABCD2345'],
    ];
    for (const [method, path] of routes) {
      const response = await request[method](path, {
        data: method === 'get' || method === 'delete' ? undefined : {},
      });
      expect(response.status(), `${method} ${path}`).toBe(401);
    }
  });

  test('reviews write routes and the details editor answer 401 anonymously', async ({ request }) => {
    const post = await request.post(`catalog/activities/${SEEDED_ACTIVITY}/reviews`, { data: {} });
    expect(post.status()).toBe(401);
    const moderate = await request.patch(`catalog/reviews/${FAKE_OBJECT_ID}`, { data: { status: 'published' } });
    expect(moderate.status()).toBe(401);
    expect((await request.get('catalog/reviews/admin')).status()).toBe(401);
    const details = await request.patch(`catalog/activities/${FAKE_OBJECT_ID}/details`, { data: {} });
    expect(details.status()).toBe(401);
  });

  test('the currency interceptor leaves checkout and booking routes untouched', async ({ request }) => {
    for (const path of [
      'checkout/cart?currency=USD',
      'checkout/cart/status?currency=USD',
      'bookings/order/OR-ABCD2345?currency=USD',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
      expect(response.headers()['x-currency'], path).toBeUndefined();
    }
  });
});

test.describe('public reviews', () => {
  test('list has a summary (or null), items and pagination; unknown slugs are 404', async ({ request }) => {
    const detail = await seededDetail(request);
    const first = (await (await request.get('catalog/activities?limit=1')).json()).items[0] as
      | { slug: string }
      | undefined;
    const slug = detail ? SEEDED_ACTIVITY : first?.slug;
    test.skip(!slug, 'No activities are published');
    const response = await request.get(`catalog/activities/${slug}/reviews?sort=top&limit=5`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.summary === null || typeof body.summary.average === 'number').toBeTruthy();
    expect(Array.isArray(body.items)).toBeTruthy();
    expect(body.pagination).toMatchObject({ page: 1, limit: 5 });
    for (const item of body.items) {
      for (const secret of ['email', 'phone', 'userId', 'bookingReference']) {
        expect(item[secret], secret).toBeUndefined();
      }
      expect(item.rating).toBeGreaterThanOrEqual(1);
    }
    expect((await request.get('catalog/activities/no-such-activity/reviews')).status()).toBe(404);
    expect((await request.get(`catalog/activities/${slug}/reviews?rating=9`)).status()).toBe(400);
    expect((await request.get(`catalog/activities/${slug}/reviews?sort=oldest`)).status()).toBe(400);
    expect((await request.get(`catalog/activities/${slug}/reviews?limit=51`)).status()).toBe(400);
  });
});

/**
 * Cart -> pay (mock) -> booking flow with a real Clerk DEVELOPMENT user, like the block above. Needs
 * PAYMENTS_MOCK=true on the server and `npm run seed:activity-details` (skips otherwise).
 */
test.describe('Clerk-authenticated cart and checkout', () => {
  const secretKey = clerkTestSecretKey();
  test.skip(!secretKey, 'CLERK_SECRET_KEY for a Clerk development instance (sk_test_...) is not set');
  test.describe.configure({ mode: 'serial' });

  let clerk: ClerkClient;
  let clerkUserId: string | undefined;
  let sessionId: string;

  async function authHeaders() {
    const { jwt } = await clerk.sessions.getToken(sessionId);
    return { Authorization: `Bearer ${jwt}` };
  }

  test.beforeAll(async () => {
    clerk = createClerkClient({ secretKey });
    const user = await clerk.users.createUser({
      emailAddress: [`api-cart-${Date.now()}+clerk_test@example.com`],
      username: `api_cart_${randomBytes(6).toString('hex')}`,
      password: `${randomBytes(18).toString('base64url')}-Aa1!`,
      firstName: 'Cart',
      lastName: 'Tester',
      skipPasswordChecks: true,
    });
    clerkUserId = user.id;
    sessionId = (await clerk.sessions.createSession({ userId: user.id })).id;
  });

  test.afterAll(async () => {
    if (clerkUserId) await clerk.users.deleteUser(clerkUserId);
  });

  let detail: { options: DetailOption[] } | null = null;
  test.beforeEach(async ({ request }) => {
    const me = await request.get('auth/me', { headers: await authHeaders() });
    test.skip(
      me.status() === 401,
      'The API under test enforces the Clerk azp claim; run it with NODE_ENV=test and CLERK_AUTHORIZED_PARTIES=*',
    );
    detail ??= await seededDetail(request);
    test.skip(!detail, 'No seeded activity details (run npm run seed:activity-details)');
  });

  let itemId: string | undefined;
  let option: DetailOption | undefined;
  let date: string | undefined;
  let orderReference: string | undefined;
  let bookingReference: string | undefined;
  let cartId: string | undefined;
  const item = (slug: string, optionId: string, day: string, adults: number, children = 0) => ({
    activitySlug: slug,
    optionId,
    date: day,
    adults,
    children,
  });

  test('an empty cart has the empty shape, never 404', async ({ request }) => {
    const response = await request.get('checkout/cart', { headers: await authHeaders() });
    expect(response.status()).toBe(200);
    const cart = await response.json();
    expect(cart.items).toEqual([]);
    expect(cart.steps).toEqual({ cart: false, pickup: false, additional: false, customer: false });
    expect(cart.pricing.total.amount).toBe(0);
  });

  test('add validates, prices server-side and replaces the same option + date', async ({ request }) => {
    const headers = await authHeaders();
    option = detail!.options.find((o) => o.pickupRequired && o.childPrice);
    test.skip(!option, 'No option with pick-up and child price');
    date = await availableDate(request, option!.id);
    test.skip(!date, 'No available date');
    const adults = Math.max(1, option!.minPax);
    const post = (data: object) => request.post('checkout/cart/items', { headers, data });

    expect((await post(item(SEEDED_ACTIVITY, option!.id, '2020-01-01', adults))).status()).toBe(409);
    expect((await post(item(SEEDED_ACTIVITY, option!.id, date!, 0))).status()).toBe(400);
    expect((await post({ ...item(SEEDED_ACTIVITY, option!.id, date!, adults), total: 1 })).status()).toBe(400);

    const added = await post(item(SEEDED_ACTIVITY, option!.id, date!, adults));
    expect(added.status()).toBe(201);
    const cart = await added.json();
    expect(cart.items).toHaveLength(1);
    expect(cart.status).toBe('open');
    cartId = cart.id;
    itemId = cart.items[0].id;
    expect(cart.items[0].option.pickupRequired).toBe(true);
    expect(cart.pricing.total.amount).toBeCloseTo(
      cart.pricing.subtotal.amount + cart.pricing.taxesAndFees.amount,
      2,
    );

    // Same option + date again REPLACES the item: same id, new traveller counts.
    const again = await (await post(item(SEEDED_ACTIVITY, option!.id, date!, adults, 1))).json();
    expect(again.items).toHaveLength(1);
    expect(again.items[0].id).toBe(itemId);
    expect(again.items[0].children).toBe(1);
    expect(again.items[0].pricing.lines).toHaveLength(2);
  });

  test('pay is refused until every step is complete', async ({ request }) => {
    test.skip(!itemId, 'No cart item');
    const early = await request.post('checkout/cart/pay', { headers: await authHeaders() });
    expect(early.status()).toBe(400);
    await expect(early.json()).resolves.toMatchObject({ code: 'STEPS_INCOMPLETE' });
  });

  test('pickup, additional details and customer steps validate and tick the flags', async ({ request }) => {
    test.skip(!itemId, 'No cart item');
    const headers = await authHeaders();
    const base = `checkout/cart/items/${itemId}`;
    expect((await request.patch(`${base}/pickup`, { headers, data: { mode: 'now' } })).status()).toBe(400);
    const pickup = await (
      await request.patch(`${base}/pickup`, {
        headers,
        data: { mode: 'now', locationName: 'Hotel Sample', address: 'Marina, Dubai' },
      })
    ).json();
    expect(pickup.steps.pickup).toBe(true);

    const longText = { specialRequests: 'x'.repeat(501) };
    expect((await request.patch(`${base}/additional`, { headers, data: longText })).status()).toBe(400);
    expect((await request.patch(`${base}/additional`, { headers, data: { price: 1 } })).status()).toBe(400);
    const additional = await (
      await request.patch(`${base}/additional`, {
        headers,
        data: { specialRequests: 'Window seat please', leadTravellerNames: ['Cart Tester'] },
      })
    ).json();
    expect(additional.steps.additional).toBe(true);

    const body = {
      fullName: 'Cart Tester',
      email: 'cart.tester@example.com',
      phoneCountryCode: '+971',
      phone: '501234567',
      nationality: 'India',
      marketingOptOut: true,
    };
    expect((await request.patch('checkout/cart/customer', { headers, data: { ...body, phone: '12' } })).status()).toBe(400);
    const customer = await (await request.patch('checkout/cart/customer', { headers, data: body })).json();
    expect(customer.steps).toEqual({ cart: true, pickup: true, additional: true, customer: true });
  });

  test('promo: unknown codes are rejected generically, a valid one lowers the total', async ({ request }) => {
    test.skip(!itemId, 'No cart item');
    const headers = await authHeaders();
    const before = await (await request.get('checkout/cart', { headers })).json();
    const bad = await request.post('checkout/cart/promo', { headers, data: { code: 'NOT-A-CODE' } });
    expect(bad.status()).toBe(400);
    await expect(bad.json()).resolves.toMatchObject({ code: 'INVALID_PROMO' });

    const good = await request.post('checkout/cart/promo', { headers, data: { code: 'welcome10' } });
    test.skip(good.status() === 400, 'Sample promo WELCOME10 is not seeded');
    const cart = await good.json();
    expect(cart.pricing.promoCode).toBe('WELCOME10');
    expect(cart.pricing.discount.amount).toBeGreaterThan(0);
    expect(cart.pricing.total.amount).toBeLessThan(before.pricing.total.amount);

    const removed = await (await request.delete('checkout/cart/promo', { headers })).json();
    expect(removed.pricing.discount.amount).toBe(0);
    expect(removed.pricing.promoCode).toBeUndefined();
  });

  test('pay (mock) confirms the booking once and repeating it is idempotent', async ({ request }) => {
    test.skip(!itemId, 'No cart item');
    const headers = await authHeaders();
    const paid = await request.post('checkout/cart/pay', { headers });
    expect(paid.status()).toBe(200);
    const result = await paid.json();
    test.skip(result.mode !== 'mock', 'Server runs with real Stripe; this test needs PAYMENTS_MOCK=true');
    expect(result).toMatchObject({ mode: 'mock', status: 'succeeded' });
    expect(result.orderReference).toMatch(/^OR-[A-Z2-7]{8}$/);
    expect(result.bookingReference).toMatch(/^TVX-\d{4}-[A-F0-9]{8}$/);
    orderReference = result.orderReference;
    bookingReference = result.bookingReference;

    const again = await (await request.post('checkout/cart/pay', { headers })).json();
    expect(again.orderReference).toBe(orderReference);
    expect(again.bookingReference).toBe(bookingReference);
  });

  test('status, session by id, booking by reference and order view agree', async ({ request }) => {
    test.skip(!orderReference, 'Payment did not run');
    const headers = await authHeaders();
    const status = await (await request.get('checkout/cart/status', { headers })).json();
    expect(status).toMatchObject({
      status: 'completed',
      orderReference,
      bookingReference,
      bookingStatus: 'confirmed',
    });
    const bySession = await (await request.get(`checkout/sessions/${cartId}/status`, { headers })).json();
    expect(bySession.status).toBe('completed');
    const session = await (await request.get(`checkout/sessions/${cartId}`, { headers })).json();
    expect(session.orderReference).toBe(orderReference);

    const booking = await (await request.get(`bookings/${bookingReference}`, { headers })).json();
    expect(booking).toMatchObject({
      status: 'confirmed',
      orderReference,
      activitySlug: SEEDED_ACTIVITY,
      serviceDay: date,
      pickup: { mode: 'now' },
      currency: 'AED',
    });
    expect(booking.customer.email).toBe('cart.tester@example.com');
    const order = await (await request.get(`bookings/order/${orderReference}`, { headers })).json();
    expect(order).toMatchObject({ orderReference, status: 'confirmed' });
    expect(order.bookings).toHaveLength(1);

    const empty = await (await request.get('checkout/cart', { headers })).json();
    expect(empty.items).toEqual([]);
  });

  test('a booking cannot be reviewed before its service date', async ({ request }) => {
    test.skip(!bookingReference, 'Payment did not run');
    const headers = await authHeaders();
    const review = await request.post(`catalog/activities/${SEEDED_ACTIVITY}/reviews`, {
      headers,
      data: { bookingReference, rating: 5, title: 'Too early', body: 'The service date has not passed yet.' },
    });
    expect(review.status()).toBe(403);
    await expect(review.json()).resolves.toMatchObject({ code: 'REVIEW_SERVICE_NOT_PASSED' });
    expect((await request.get(`checkout/sessions/${FAKE_OBJECT_ID}`, { headers })).status()).toBe(404);
  });

  test('a customer gets 403 on promo, review moderation and details editing', async ({ request }) => {
    const headers = await authHeaders();
    expect((await request.get('checkout/promos', { headers })).status()).toBe(403);
    expect((await request.get('catalog/reviews/admin', { headers })).status()).toBe(403);
    const moderate = await request.patch(`catalog/reviews/${FAKE_OBJECT_ID}`, {
      headers,
      data: { status: 'published' },
    });
    expect(moderate.status()).toBe(403);
    const details = await request.patch(`catalog/activities/${FAKE_OBJECT_ID}/details`, { headers, data: {} });
    expect(details.status()).toBe(403);
  });

  test('a cart holds at most five items; Modify re-prices and Remove releases items', async ({ request }) => {
    test.skip(!option, 'No option selected earlier');
    const headers = await authHeaders();
    const adults = Math.max(1, option!.minPax);
    const dates: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = await availableDate(request, option!.id, i);
      if (d) dates.push(d);
    }
    test.skip(dates.length < 6, 'Fewer than six available dates');
    const post = (day: string) =>
      request.post('checkout/cart/items', { headers, data: item(SEEDED_ACTIVITY, option!.id, day, adults) });

    let last: { items: Array<{ id: string }> } | undefined;
    for (const day of dates.slice(0, 5)) {
      const response = await post(day);
      expect(response.status()).toBe(201);
      last = await response.json();
    }
    expect(last!.items).toHaveLength(5);
    const full = await post(dates[5]);
    expect(full.status()).toBe(409);
    await expect(full.json()).resolves.toMatchObject({ code: 'CART_FULL' });

    const modify = (id: string) =>
      request.patch(`checkout/cart/items/${id}`, {
        headers,
        data: item(SEEDED_ACTIVITY, option!.id, dates[5], adults),
      });
    expect((await modify(last!.items[0].id)).status()).toBe(200);
    const dup = await modify(last!.items[1].id);
    expect(dup.status()).toBe(409);
    await expect(dup.json()).resolves.toMatchObject({ code: 'DUPLICATE_ITEM' });

    let current = await (await request.delete(`checkout/cart/items/${last!.items[0].id}`, { headers })).json();
    expect(current.items).toHaveLength(4);
    for (const entry of [...current.items]) {
      current = await (await request.delete(`checkout/cart/items/${entry.id}`, { headers })).json();
    }
    expect(current.items).toEqual([]);
  });
});
