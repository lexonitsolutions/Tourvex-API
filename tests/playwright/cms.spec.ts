import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { type ClerkClient, createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import mongoose from 'mongoose';

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = resolve(process.cwd(), '.env');
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8'))[name] : undefined;
}

const secretKey = envValue('CLERK_SECRET_KEY')?.startsWith('sk_test_') ? envValue('CLERK_SECRET_KEY') : undefined;

// 1x1 transparent PNG.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const ADMIN_ROUTES: [string, string][] = [
  ['GET', 'admin/content'],
  ['GET', 'admin/content/global.seo'],
  ['PUT', 'admin/content/global.seo/draft'],
  ['POST', 'admin/content/global.seo/publish'],
  ['POST', 'admin/content/global.seo/discard'],
  ['GET', 'admin/content/global.seo/revisions'],
  ['POST', 'admin/content/global.seo/preview-token'],
  ['GET', 'admin/media'],
  ['POST', 'admin/media'],
];

test.describe('cms public endpoints', () => {
  test('GET /content/:key returns the published payload with cache headers and a strong ETag', async ({ request }) => {
    const response = await request.get('content/page.home');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=30, stale-while-revalidate=300');
    const etag = response.headers().etag;
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    const body = await response.json();
    expect(body).toMatchObject({ key: 'page.home', locale: 'en' });
    expect(typeof body.version).toBe('number');
    expect(body.sections[0]).toMatchObject({ type: 'hero', enabled: true });
    expect(body.sections.map((s: { type: string }) => s.type)).toEqual(
      expect.arrayContaining(['categoryTiles', 'bestSellers', 'exploreByExperience', 'partners', 'why']),
    );
    expect(body.data).toBeUndefined();

    const cached = await request.get('content/page.home', { headers: { 'If-None-Match': etag } });
    expect(cached.status()).toBe(304);
  });

  test('globals carry data, the batch endpoint returns several keys, unknown keys are 404', async ({ request }) => {
    const seo = await (await request.get('content/global.seo?locale=en')).json();
    expect(seo.data.siteName).toBeTruthy();
    expect(seo.sections).toBeUndefined();

    const batch = await request.get('content?keys=page.home,global.header,global.footer,global.seo');
    expect(batch.status()).toBe(200);
    const items = (await batch.json()).items;
    expect(Object.keys(items).sort()).toEqual(['global.footer', 'global.header', 'global.seo', 'page.home']);
    expect(items['global.header'].data.tabs.length).toBeGreaterThan(0);

    const unknown = await request.get('content/page.nope');
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).code).toBe('CONTENT_NOT_FOUND');
    expect((await request.get('content?keys=page.home,page.nope')).status()).toBe(404);
  });

  test('locale and batch limits are validated', async ({ request }) => {
    expect((await request.get('content/page.home?locale=ar')).status()).toBe(400);
    expect((await request.get('content/page.home?locale=EN1')).status()).toBe(400);
    const keys = Array.from({ length: 11 }, (_, i) => `page.k${i}`).join(',');
    expect((await request.get(`content?keys=${keys}`)).status()).toBe(400);
    expect((await request.get('content')).status()).toBe(400);
  });

  test('an invalid preview token is refused and never reveals a draft', async ({ request }) => {
    for (const token of ['nope', 'a.b', `${'x'.repeat(40)}.${'y'.repeat(40)}`]) {
      const response = await request.get(`content/global.seo?preview=${token}`);
      expect(response.status()).toBe(403);
      expect((await response.json()).code).toBe('PREVIEW_INVALID');
    }
  });

  test('admin routes answer 401 without a token', async ({ request }) => {
    for (const [method, path] of ADMIN_ROUTES) {
      const response = await request.fetch(path, { method, data: method === 'PUT' ? {} : undefined });
      expect(response.status(), `${method} ${path}`).toBe(401);
    }
  });
});

test.describe('cms admin (Clerk-authenticated)', () => {
  test.skip(!secretKey, 'CLERK_SECRET_KEY for a Clerk development instance (sk_test_...) is not set');
  test.describe.configure({ mode: 'serial' });

  const mongoUri = envValue('MONGODB_URI') ?? 'mongodb://127.0.0.1:27017/tourvex_test';
  const stamp = Date.now();
  const roles = ['editor', 'sales', 'customer'] as const;
  type Who = (typeof roles)[number];
  const emails = Object.fromEntries(roles.map((who) => [who, `cms-${who}-${stamp}+clerk_test@example.com`])) as Record<Who, string>;
  const staffRoles: Partial<Record<Who, string[]>> = { editor: ['content'], sales: ['sales'] };
  const clerkIds: string[] = [];
  const sessions: Partial<Record<Who, string>> = {};
  const uploaded: string[] = [];
  let clerk: ClerkClient;
  let connection: mongoose.Connection;
  let originalSeo: { data: Record<string, unknown> };

  const auth = async (who: Who) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const { jwt } = await clerk.sessions.getToken(sessions[who]!);
        return { Authorization: `Bearer ${jwt}` };
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  };

  test.beforeAll(async () => {
    clerk = createClerkClient({ secretKey });
    connection = await mongoose.createConnection(mongoUri).asPromise();
    for (const who of roles) {
      await connection.collection('users').insertOne({
        firstName: 'Cms',
        lastName: `Tester ${who}`,
        email: emails[who],
        roles: ['customer', ...(staffRoles[who] ?? [])],
        status: 'active',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const user = await clerk.users.createUser({
        emailAddress: [emails[who]],
        username: `cms_test_${randomBytes(6).toString('hex')}`,
        password: `${randomBytes(18).toString('base64url')}-Aa1!`,
        firstName: 'Cms',
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
    const marker = new RegExp(`^cms-.*-${stamp}\\+clerk_test@example\\.com$`);
    // Remove leftovers: uploads, throwaway users and the audit rows they produced.
    const files = connection.collection('media.files');
    for (const filename of uploaded) {
      const file = await files.findOne({ filename });
      if (file) {
        await connection.collection('media.chunks').deleteMany({ files_id: file._id });
        await files.deleteOne({ _id: file._id });
      }
    }
    await connection.collection('audit_logs').deleteMany({ actorEmail: marker });
    await connection.collection('users').deleteMany({ email: marker });
    await connection.close();
  });

  test('permissions: customers and non-content staff are 403, content staff can read and write', async ({ request }) => {
    for (const who of ['customer', 'sales'] as const) {
      const headers = await auth(who);
      for (const [method, path] of ADMIN_ROUTES) {
        const response = await request.fetch(path, { method, headers, data: method === 'PUT' ? {} : undefined });
        expect(response.status(), `${who} ${method} ${path}`).toBe(403);
      }
    }
    const headers = await auth('editor');
    const meResponse = await request.get('admin/me', { headers });
    expect(meResponse.status(), await meResponse.text()).toBe(200);
    const me = await meResponse.json();
    expect(me.permissions).toEqual(expect.arrayContaining(['cms.read', 'cms.write', 'cms.publish']));
    expect(me.menu.map((m: { id: string }) => m.id)).toContain('content');
    const sales = await (await request.get('admin/me', { headers: await auth('sales') })).json();
    expect(sales.permissions).not.toContain('cms.read');
    expect(sales.menu.map((m: { id: string }) => m.id)).not.toContain('content');
  });

  test('list and detail expose status, schema and section schemas', async ({ request }) => {
    const headers = await auth('editor');
    const list = await request.get('admin/content', { headers });
    expect(list.status()).toBe(200);
    expect(list.headers()['cache-control']).toBe('no-store');
    const rows = await list.json();
    expect(rows.map((r: { key: string }) => r.key)).toEqual(['page.home', 'global.header', 'global.footer', 'global.seo']);
    expect(rows[0]).toMatchObject({ kind: 'page', locale: 'en' });
    expect(['published', 'draft-changes', 'never-published']).toContain(rows[0].status);

    const home = await (await request.get('admin/content/page.home', { headers })).json();
    expect(home.schema).toMatchObject({ key: 'page.home', kind: 'page', previewPath: '/' });
    expect(home.sectionSchemas.hero.fields.some((f: { name: string }) => f.name === 'slides')).toBe(true);
    expect(home.published.sections.length).toBeGreaterThan(5);
    expect(typeof home.draftRevision).toBe('number');

    const seo = await (await request.get('admin/content/global.seo', { headers })).json();
    originalSeo = { data: seo.published.data };
    expect(seo.schema.fields.map((f: { name: string }) => f.name)).toContain('siteName');
    expect((await request.get('admin/content/page.nope', { headers })).status()).toBe(404);
  });

  test('validation errors: javascript: and http links, unknown fields, bad images, missing sections', async ({ request }) => {
    const headers = await auth('editor');
    const footer = (await (await request.get('admin/content/global.footer', { headers })).json()).published.data;

    const bad = structuredClone(footer);
    bad.groups[0].links[0].link.href = 'javascript:alert(1)';
    bad.groups[0].links[1].link.href = 'http://insecure.example.com';
    bad.logo.url = 'data:image/png;base64,AAAA';
    bad.surprise = true;
    bad.about = '<script>alert(1)</script>';
    const response = await request.put('admin/content/global.footer/draft', { headers, data: { data: bad, draftRevision: 0 } });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('VALIDATION_FAILED');
    const paths = body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['data.groups[0].links[0].link.href', 'data.groups[0].links[1].link.href', 'data.logo.url', 'data.surprise', 'data.about']),
    );

    const home = (await (await request.get('admin/content/page.home', { headers })).json()).published;
    const noHero = { sections: home.sections.filter((s: { type: string }) => s.type !== 'hero') };
    const missing = await request.put('admin/content/page.home/draft', { headers, data: noHero });
    expect(missing.status()).toBe(400);
    expect((await missing.json()).errors[0].message).toMatch(/hero|Hero/);

    const wrongShape = await request.put('admin/content/page.home/draft', { headers, data: { data: {} } });
    expect(wrongShape.status()).toBe(400);
    // Nothing was stored.
    const after = await (await request.get('admin/content/global.footer', { headers })).json();
    expect(after.hasDraft).toBe(false);
  });

  test('draft, preview, publish, history, restore and discard flow', async ({ request }) => {
    const headers = await auth('editor');
    const start = await (await request.get('admin/content/global.seo', { headers })).json();
    const edited = structuredClone(start.published.data);
    const marker = `Karnish CMS test ${stamp}`;
    edited.siteName = marker;

    // Save draft.
    const saved = await request.put('admin/content/global.seo/draft', {
      headers,
      data: { data: edited, baseVersion: start.version, draftRevision: start.draftRevision },
    });
    expect(saved.status()).toBe(200);
    const draft = await saved.json();
    expect(draft).toMatchObject({ hasDraft: true, status: 'draft-changes', draftRevision: start.draftRevision + 1 });
    expect(draft.draft.data.siteName).toBe(marker);
    expect(draft.published.data.siteName).not.toBe(marker);

    // Stale revision -> 409 with the latest document.
    const stale = await request.put('admin/content/global.seo/draft', {
      headers,
      data: { data: edited, draftRevision: start.draftRevision },
    });
    expect(stale.status()).toBe(409);
    const conflict = await stale.json();
    expect(conflict.code).toBe('CONTENT_CONFLICT');
    expect(conflict.latest.draftRevision).toBe(draft.draftRevision);
    // Wrong base version and If-Match too.
    expect(
      (await request.put('admin/content/global.seo/draft', { headers, data: { data: edited, baseVersion: start.version + 7 } })).status(),
    ).toBe(409);
    expect(
      (await request.put('admin/content/global.seo/draft', { headers: { ...headers, 'If-Match': '"0.0"' }, data: { data: edited } })).status(),
    ).toBe(409);

    // The public endpoint still shows the published value.
    expect((await (await request.get('content/global.seo')).json()).data.siteName).not.toBe(marker);

    // Preview token: draft visible, no-store, noindex, bound to the key.
    const issued = await request.post('admin/content/global.seo/preview-token', { headers });
    expect(issued.status()).toBe(201);
    const { token, url, expiresAt } = await issued.json();
    expect(url).toContain(`?cmsPreview=${token}`);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    const preview = await request.get(`content/global.seo?preview=${token}`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()['cache-control']).toBe('no-store');
    expect(preview.headers()['x-robots-tag']).toBe('noindex');
    expect((await preview.json()).data.siteName).toBe(marker);
    expect((await request.get(`content/global.footer?preview=${token}`)).status()).toBe(403);
    const batchPreview = await request.get(`content?keys=global.seo,global.footer&preview=${token}`);
    expect(batchPreview.headers()['cache-control']).toBe('no-store');
    const batchItems = (await batchPreview.json()).items;
    expect(batchItems['global.seo'].data.siteName).toBe(marker);
    expect(batchItems['global.footer'].data.copyright).toBeTruthy();

    // Publish.
    const published = await request.post('admin/content/global.seo/publish', { headers, data: { note: 'cms playwright test' } });
    expect(published.status()).toBe(201);
    const after = await published.json();
    expect(after).toMatchObject({ hasDraft: false, status: 'published', version: start.version + 1 });
    expect((await (await request.get('content/global.seo')).json()).data.siteName).toBe(marker);
    expect((await request.post('admin/content/global.seo/publish', { headers, data: {} })).status()).toBe(409);

    // History.
    const revisions = await (await request.get('admin/content/global.seo/revisions', { headers })).json();
    expect(revisions[0]).toMatchObject({ version: start.version + 1, note: 'cms playwright test' });
    const detail = await (await request.get(`admin/content/global.seo/revisions/${start.version + 1}`, { headers })).json();
    expect(detail.data.siteName).toBe(marker);
    expect((await request.get('admin/content/global.seo/revisions/9999', { headers })).status()).toBe(404);

    // Restore the original revision into the draft (never publishes), then discard it.
    const origVersion = revisions.find((r: { version: number }) => r.version === start.version)?.version;
    if (origVersion) {
      const restored = await request.post(`admin/content/global.seo/revisions/${origVersion}/restore`, { headers });
      expect(restored.status()).toBe(201);
      expect((await restored.json()).hasDraft).toBe(true);
      expect((await (await request.get('content/global.seo')).json()).data.siteName).toBe(marker);
    }
    const discarded = await request.post('admin/content/global.seo/discard', { headers });
    expect(discarded.status()).toBe(201);
    expect((await discarded.json()).hasDraft).toBe(false);

    // Put the original content back (publishes a new version identical to the original).
    const revert = await request.put('admin/content/global.seo/draft', { headers, data: originalSeo });
    expect(revert.status()).toBe(200);
    expect((await request.post('admin/content/global.seo/publish', { headers, data: { note: 'restore original after test' } })).status()).toBe(201);
    expect((await (await request.get('content/global.seo')).json()).data).toEqual(originalSeo.data);
  });

  test('media upload accepts a real PNG and serves it through the media route', async ({ request }) => {
    const headers = await auth('editor');
    const response = await request.post('admin/media', { headers, multipart: { file: { name: 'My Photo.png', mimeType: 'image/png', buffer: PNG_1X1 } } });
    expect(response.status()).toBe(201);
    const media = await response.json();
    uploaded.push(media.filename);
    expect(media).toMatchObject({ width: 1, height: 1, contentType: 'image/png', size: PNG_1X1.length });
    expect(media.filename).toMatch(/^cms-[0-9a-f]{16}\.png$/);
    expect(media.url).toBe(`/images/${media.filename}`);

    const served = await request.get(`media/images/${media.filename}`);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/png');
    expect(Buffer.compare(await served.body(), PNG_1X1)).toBe(0);

    const list = await (await request.get(`admin/media?q=${media.filename}`, { headers })).json();
    expect(list.items[0]).toMatchObject({ id: media.id, filename: media.filename, source: 'upload', width: 1 });
    expect(list.pagination.total).toBe(1);
  });

  test('media upload rejections: SVG, oversize, wrong magic bytes, mismatched type, huge dimensions, missing file', async ({ request }) => {
    const headers = await auth('editor');
    const post = (file: { name: string; mimeType: string; buffer: Buffer }) =>
      request.post('admin/media', { headers, multipart: { file } });
    const code = async (response: Awaited<ReturnType<typeof post>>) => (await response.json()).code;

    const svg = await post({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    expect(svg.status()).toBe(415);
    expect(await code(svg)).toBe('SVG_NOT_ALLOWED');

    const svgAsPng = await post({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>') });
    expect(svgAsPng.status()).toBe(415);
    expect(await code(svgAsPng)).toBe('SVG_NOT_ALLOWED');

    const fake = await post({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('this is definitely not a png file at all') });
    expect(fake.status()).toBe(415);
    expect(await code(fake)).toBe('UNSUPPORTED_TYPE');

    const gif = await post({ name: 'x.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary') });
    expect(gif.status()).toBe(415);

    const mismatch = await post({ name: 'x.jpg', mimeType: 'image/jpeg', buffer: PNG_1X1 });
    expect(mismatch.status()).toBe(415);
    expect(await code(mismatch)).toBe('MIME_MISMATCH');

    const oversize = await post({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.concat([PNG_1X1, Buffer.alloc(5 * 1024 * 1024 + 10)]) });
    expect(oversize.status()).toBe(413);
    expect(await code(oversize)).toBe('IMAGE_TOO_LARGE');

    const huge = Buffer.from(PNG_1X1);
    huge.writeUInt32BE(9000, 16);
    const dimension = await post({ name: 'wide.png', mimeType: 'image/png', buffer: huge });
    expect(dimension.status()).toBe(413);
    expect(await code(dimension)).toBe('IMAGE_TOO_LARGE');

    const empty = await post({ name: 'e.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    expect(empty.status()).toBe(400);

    const none = await request.post('admin/media', { headers, multipart: { note: 'no file here' } });
    expect(none.status()).toBe(400);
    expect(await code(none)).toBe('FILE_REQUIRED');
  });

  test('media delete: protected while referenced, allowed afterwards, site images are protected', async ({ request }) => {
    const headers = await auth('editor');
    const upload = await request.post('admin/media', { headers, multipart: { file: { name: 'ref.png', mimeType: 'image/png', buffer: PNG_1X1 } } });
    const media = await upload.json();
    uploaded.push(media.filename);

    const seo = await (await request.get('admin/content/global.seo', { headers })).json();
    const data = structuredClone(seo.published.data);
    data.ogImage = { url: media.url, alt: 'test' };
    const draft = await request.put('admin/content/global.seo/draft', { headers, data: { data, draftRevision: seo.draftRevision } });
    expect(draft.status()).toBe(200);

    const blocked = await request.delete(`admin/media/${media.id}`, { headers });
    expect(blocked.status()).toBe(409);
    const blockedBody = await blocked.json();
    expect(blockedBody.code).toBe('MEDIA_IN_USE');
    expect(blockedBody.references).toEqual([{ key: 'global.seo', locale: 'en', where: 'draft' }]);

    expect((await request.post('admin/content/global.seo/discard', { headers })).status()).toBe(201);
    const removed = await request.delete(`admin/media/${media.id}`, { headers });
    expect(removed.status()).toBe(200);
    expect((await request.get(`media/images/${media.filename}`)).status()).toBe(404);
    expect((await request.delete(`admin/media/${media.id}`, { headers })).status()).toBe(404);
    expect((await request.delete('admin/media/not-an-id', { headers })).status()).toBe(400);

    const site = await (await request.get('admin/media?limit=100', { headers })).json();
    const seeded = site.items.find((item: { source: string }) => item.source === 'site');
    if (seeded) {
      const protectedDelete = await request.delete(`admin/media/${seeded.id}`, { headers });
      expect(protectedDelete.status()).toBe(403);
      expect((await protectedDelete.json()).code).toBe('MEDIA_PROTECTED');
    }
  });

  test('every mutation is audited', async () => {
    const rows = await connection
      .collection('audit_logs')
      .find({ actorEmail: emails.editor, entityType: { $in: ['content', 'content_media'] } })
      .toArray();
    const actions = new Set(rows.map((row) => row.action));
    for (const action of ['content.draft_save', 'content.publish', 'content.restore', 'content.discard', 'media.upload', 'media.delete']) {
      expect(actions, action).toContain(action);
    }
    const publish = rows.find((row) => row.action === 'content.publish');
    expect(publish?.entityId).toBe('global.seo');
    expect(JSON.stringify(publish?.changes)).toContain('data.siteName');
    expect(JSON.stringify(rows)).not.toMatch(/Bearer|eyJ/);
  });
});
