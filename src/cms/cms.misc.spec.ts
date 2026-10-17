import { summarizeChanges } from './cms.changes';
import { loadDefaults } from './cms.defaults';
import { cleanOriginalName, MAX_DIMENSION, probeImage, randomMediaFilename, sniffImageType } from './cms.image';
import { derivePreviewSecret, signPreviewToken, verifyPreviewToken } from './cms.preview-token';
import type { Field } from './cms.types';
import { validateDocumentPayload } from './cms.validator';
import { checkRegistry, DOCUMENT_SCHEMAS, getDocumentSchema, isSupportedLocale, listDocumentKeys, sectionSchemasFor } from './schemas';

describe('schema registry', () => {
  it('is internally consistent', () => expect(checkRegistry()).toEqual([]));
  it('exposes the Phase A documents', () => {
    expect(listDocumentKeys()).toEqual(['page.home', 'page.activities', 'page.events', 'page.holidays', 'page.voyager', 'page.about', 'page.services', 'page.team', 'page.partners', 'global.header', 'global.footer', 'global.seo']);
    expect(getDocumentSchema('nope')).toBeUndefined();
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('ar')).toBe(false);
  });
  it('page.home allows every section type once with a fixed hero', () => {
    const home = getDocumentSchema('page.home')!;
    const sections = sectionSchemasFor(home);
    expect(Object.keys(sections)).toEqual(home.sections!.allowed);
    expect(sections.hero.fixed).toBe(true);
    expect(Object.values(sections).every((s) => s.single)).toBe(true);
  });
  it('every field has a unique name per level, a label and sane bounds', () => {
    const check = (fields: Field[]) => {
      const names = fields.map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
      for (const f of fields) {
        expect(f.label.length).toBeGreaterThan(0);
        if (f.type === 'list') {
          expect(f.max).toBeGreaterThanOrEqual(Math.max(1, f.min ?? 0));
          check(f.fields);
        }
        if (f.type === 'group') check(f.fields);
        if (f.type === 'number') expect(f.max).toBeGreaterThan(f.min);
        if (f.type === 'select') expect(f.options.length).toBeGreaterThan(0);
        if (f.type === 'text' || f.type === 'textarea' || f.type === 'richtext') expect(f.maxLength).toBeGreaterThan(0);
        if (f.type === 'text' && f.pattern) expect(() => new RegExp(f.pattern!)).not.toThrow();
      }
    };
    for (const schema of DOCUMENT_SCHEMAS) {
      if (schema.fields) check(schema.fields);
      for (const section of Object.values(sectionSchemasFor(schema))) check(section.fields);
    }
  });
});

describe('seed defaults', () => {
  it.each(listDocumentKeys())('%s validates against its schema without changes', (key) => {
    const schema = getDocumentSchema(key)!;
    const defaults = loadDefaults(key);
    expect(defaults).not.toBeNull();
    const result = validateDocumentPayload(schema, sectionSchemasFor(schema), defaults);
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual(defaults);
  });
  it('home defaults list every section in the default order', () => {
    const defaults = loadDefaults('page.home') as { sections: { type: string }[] };
    expect(defaults.sections.map((s) => s.type)).toEqual(getDocumentSchema('page.home')!.sections!.default);
  });
  it('returns copies and rejects odd keys', () => {
    const a = loadDefaults('global.seo') as { data: { siteName: string } };
    a.data.siteName = 'changed';
    expect((loadDefaults('global.seo') as { data: { siteName: string } }).data.siteName).toBe('Karnish Tourism');
    expect(loadDefaults('../etc/passwd')).toBeNull();
    expect(loadDefaults('missing.key')).toBeNull();
  });
});

describe('preview tokens', () => {
  const secret = derivePreviewSecret('s3cret', undefined);
  const now = 1_700_000_000_000;
  it('round-trips for the bound key and locale', () => {
    const { token, expiresAt } = signPreviewToken(secret, 'page.home', 'en', now);
    expect(expiresAt).toBe(now + 15 * 60 * 1000);
    expect(verifyPreviewToken(secret, token, 'page.home', 'en', now + 1000).valid).toBe(true);
  });
  it('rejects another key or locale, expiry, tampering, another secret and garbage', () => {
    const { token } = signPreviewToken(secret, 'page.home', 'en', now);
    expect(verifyPreviewToken(secret, token, 'global.seo', 'en', now)).toEqual({ valid: false, reason: 'key' });
    expect(verifyPreviewToken(secret, token, 'page.home', 'ar', now)).toEqual({ valid: false, reason: 'key' });
    expect(verifyPreviewToken(secret, token, 'page.home', 'en', now + 15 * 60 * 1000 + 1)).toEqual({ valid: false, reason: 'expired' });
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'global.seo', l: 'en', e: now + 10 ** 9 })).toString('base64url');
    expect(verifyPreviewToken(secret, `${forged}.${sig}`, 'global.seo', 'en', now)).toEqual({ valid: false, reason: 'signature' });
    expect(verifyPreviewToken(secret, `${payload}.${sig.slice(0, -2)}AA`, 'page.home', 'en', now).valid).toBe(false);
    expect(verifyPreviewToken('other', token, 'page.home', 'en', now)).toEqual({ valid: false, reason: 'signature' });
    for (const bad of ['', 'a', 'a.b.c', undefined, 42, '.', 'x'.repeat(600)]) {
      expect(verifyPreviewToken(secret, bad, 'page.home', 'en', now).valid).toBe(false);
    }
  });
  it('derives the secret from the Clerk secret when none is configured', () => {
    expect(derivePreviewSecret(undefined, 'sk_x')).toBe('cms-preview:sk_x');
    expect(derivePreviewSecret('own', 'sk_x')).toBe('own');
    expect(derivePreviewSecret(undefined, undefined)).toContain('cms-preview:');
  });
});

describe('image probing', () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const jpeg = (w: number, h: number) => {
    const b = Buffer.alloc(30);
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]).copy(b);
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, 8);
    b.writeUInt16BE(h, 13);
    b.writeUInt16BE(w, 15);
    return b;
  };
  const webpLossy = (w: number, h: number) => {
    const b = Buffer.alloc(40);
    b.write('RIFF', 0, 'ascii');
    b.write('WEBP', 8, 'ascii');
    b.write('VP8 ', 12, 'ascii');
    Buffer.from([0x9d, 0x01, 0x2a]).copy(b, 23);
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
    return b;
  };
  const webpX = (w: number, h: number) => {
    const b = Buffer.alloc(40);
    b.write('RIFF', 0, 'ascii');
    b.write('WEBP', 8, 'ascii');
    b.write('VP8X', 12, 'ascii');
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
    return b;
  };
  const avif = (w: number, h: number) => {
    const b = Buffer.alloc(64);
    b.writeUInt32BE(24, 0);
    b.write('ftypavif', 4, 'ascii');
    b.write('ispe', 32, 'ascii');
    b.writeUInt32BE(w, 40);
    b.writeUInt32BE(h, 44);
    return b;
  };

  it('reads type and size for each supported format', () => {
    expect(probeImage(png(640, 480))).toEqual({ ok: true, type: 'png', width: 640, height: 480 });
    expect(probeImage(jpeg(800, 600))).toEqual({ ok: true, type: 'jpeg', width: 800, height: 600 });
    expect(probeImage(webpLossy(320, 200))).toEqual({ ok: true, type: 'webp', width: 320, height: 200 });
    expect(probeImage(webpX(1000, 500))).toEqual({ ok: true, type: 'webp', width: 1000, height: 500 });
    expect(probeImage(avif(1200, 900))).toEqual({ ok: true, type: 'avif', width: 1200, height: 900 });
  });
  it('refuses SVG and markup, wrong magic bytes, empty and corrupt files', () => {
    expect(probeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject({ ok: false, code: 'SVG_NOT_ALLOWED' });
    expect(probeImage(Buffer.from('<?xml version="1.0"?><svg/>'))).toMatchObject({ code: 'SVG_NOT_ALLOWED' });
    expect(probeImage(Buffer.from('<!DOCTYPE html><html></html>'))).toMatchObject({ code: 'SVG_NOT_ALLOWED' });
    expect(probeImage(Buffer.from('GIF89a......'))).toMatchObject({ code: 'UNSUPPORTED_TYPE' });
    expect(probeImage(Buffer.from('just some text pretending to be a png'))).toMatchObject({ code: 'UNSUPPORTED_TYPE' });
    expect(probeImage(Buffer.alloc(0))).toMatchObject({ code: 'INVALID_IMAGE' });
    expect(probeImage(png(0, 10))).toMatchObject({ code: 'INVALID_IMAGE' });
    expect(probeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]))).toMatchObject({ code: 'INVALID_IMAGE' });
  });
  it('enforces the dimension and size limits', () => {
    expect(probeImage(png(MAX_DIMENSION, MAX_DIMENSION)).ok).toBe(true);
    expect(probeImage(png(MAX_DIMENSION + 1, 10))).toMatchObject({ ok: false, code: 'IMAGE_TOO_LARGE' });
    expect(probeImage(jpeg(100, 9000))).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(probeImage(Buffer.concat([png(10, 10), Buffer.alloc(5 * 1024 * 1024)]))).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
  });
  it('does not mistake look-alike headers for images', () => {
    expect(sniffImageType(Buffer.from('RIFFxxxxWEBX'))).toBeNull();
    expect(sniffImageType(Buffer.from('....ftypmp42....'))).toBeNull();
  });
  it('generates random safe filenames and cleans original names', () => {
    const a = randomMediaFilename('jpeg');
    expect(a).toMatch(/^cms-[0-9a-f]{16}\.jpg$/);
    expect(a).not.toBe(randomMediaFilename('jpeg'));
    expect(cleanOriginalName('..\\..\\evil<script>.png')).toBe('evilscript.png');
    expect(cleanOriginalName(undefined)).toBe('');
  });
});

describe('change summaries', () => {
  it('reports changed leaves, list items by id, additions and moves', () => {
    const before = { sections: [{ id: 'a', data: { t: 'x', items: [{ id: 'i1', v: 1 }, { id: 'i2', v: 2 }] } }] };
    const after = { sections: [{ id: 'a', data: { t: 'y', items: [{ id: 'i2', v: 2 }, { id: 'i1', v: 3 }, { id: 'i3', v: 4 }] } }] };
    const changes = summarizeChanges(before, after);
    const fields = changes.map((c) => c.field);
    expect(fields).toContain('sections[a].data.t');
    expect(fields).toContain('sections[a].data.items[i1].v');
    expect(fields).toContain('sections[a].data.items[i3]');
    expect(fields).toContain('sections[a].data.items.order');
    expect(changes.find((c) => c.field === 'sections[a].data.t')).toEqual({ field: 'sections[a].data.t', from: 'x', to: 'y' });
  });
  it('is empty for equal payloads, truncates long strings and caps the list', () => {
    expect(summarizeChanges({ a: 1 }, { a: 1 })).toEqual([]);
    const long = summarizeChanges({ a: '' }, { a: 'x'.repeat(500) });
    expect((long[0].to as string).length).toBeLessThan(200);
    const many = summarizeChanges(
      Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 1])),
      Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 2])),
    );
    expect(many).toHaveLength(40);
  });
});
