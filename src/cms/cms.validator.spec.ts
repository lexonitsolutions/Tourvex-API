import type { DocumentSchema, Field, SectionSchema } from './cms.types';
import {
  checkRichtext,
  isSafeHref,
  isSafeImageUrl,
  sanitizeMultiline,
  sanitizeText,
  validateDocumentPayload,
  validateFields,
} from './cms.validator';
import { link, list, group, text, textarea, richtext, image, toggle, number, select, color } from './schemas/fields';

let counter = 0;
const idGenerator = () => `gen${++counter}`;
const run = (fields: Field[], raw: unknown) => validateFields(fields, raw, { idGenerator });
const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('sanitisers', () => {
  it('strips control characters and bidi overrides, keeps emoji joiners', () => {
    expect(sanitizeText('  a\u0000b\u0007c‮d  ')).toBe('abcd');
    expect(sanitizeText('line1\nline2\t3')).toBe('line1 line2 3');
    expect(sanitizeText('🏝️')).toBe('🏝️');
    expect(sanitizeText('👩‍💻')).toBe('👩‍💻');
  });
  it('keeps line breaks in multiline text and normalises CRLF', () => {
    expect(sanitizeMultiline('a\r\nb\rc\u0000')).toBe('a\nb\nc');
  });
});

describe('isSafeHref', () => {
  it.each(['/', '/activities?destination=Abu%20Dhabi', '/a/b#x', 'https://example.com/x?y=1', 'mailto:a@b.co', 'tel:+971 5'.replace(' ', '')])(
    'accepts %s',
    (href) => expect(isSafeHref(href)).toBe(true),
  );
  it.each([
    '',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<b>',
    'http://example.com',
    '//evil.com',
    'ftp://x.y',
    'vbscript:x',
    '/a b',
    '/a"b',
    '/a\\b',
    'https://user:pw@example.com',
    'https://',
    'relative/path',
    '/x\u0000y',
  ])('rejects %j', (href) => expect(isSafeHref(href)).toBe(false));
});

describe('isSafeImageUrl', () => {
  it.each(['/images/destination-03.jpg', '/api/v1/media/images/cms-abc123.webp', 'https://cdn.example.com/a.png'])(
    'accepts %s',
    (url) => expect(isSafeImageUrl(url)).toBe(true),
  );
  it.each(['', 'http://x.com/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '/other/a.png', '/images/../secret', '//cdn.com/a.png', '/images/a b.png', 'https://x.com/<script>'])(
    'rejects %j',
    (url) => expect(isSafeImageUrl(url)).toBe(false),
  );
});

describe('checkRichtext', () => {
  it('accepts the markdown subset', () => {
    expect(checkRichtext('**bold** and *italic* with [a link](/x) and [out](https://a.b/c)\n- one\n- two')).toBeNull();
  });
  it.each([
    ['<b>x</b>', /HTML/],
    ['text <script>alert(1)</script>', /HTML/],
    ['<!-- c -->', /HTML/],
    ['![img](https://a.b/c.png)', /Images/],
    ['[x](javascript:alert(1))', /Unsafe/],
    ['[x](http://a.b)', /Unsafe/],
    ['[](/x)', /needs text/],
    ['broken ](/x) link', /Malformed/],
  ])('rejects %j', (value, message) => {
    expect(checkRichtext(value)?.message).toMatch(message);
  });
});

describe('field validation', () => {
  it('text: required, maxLength, html, pattern, trims, defaults empty', () => {
    const fields = [text('a', 'A', 5, { required: true }), text('b', 'B', 3), text('c', 'C', 20, { pattern: '^\\d+$', patternMessage: 'digits' })];
    expect(run(fields, { a: '  hi  ' }).value).toEqual({ a: 'hi', b: '', c: '' });
    expect(run(fields, { a: '' }).issues).toEqual([{ path: 'data.a', message: 'is required' }]);
    expect(run(fields, {}).issues[0].message).toBe('is required');
    expect(run(fields, { a: 'abcdef' }).issues[0].message).toMatch(/at most 5/);
    expect(run(fields, { a: '<b>x' }).issues[0].message).toMatch(/HTML/);
    expect(run(fields, { a: 'x', c: 'abc' }).issues).toEqual([{ path: 'data.c', message: 'digits' }]);
    expect(run(fields, { a: 5 }).issues[0].message).toBe('must be a string');
  });

  it('rejects unknown fields', () => {
    const r = run([text('a', 'A', 5)], { a: 'x', evil: 1, nested: {} });
    expect(paths(r.issues)).toEqual(['data.evil', 'data.nested']);
  });

  it('textarea keeps line breaks', () => {
    const r = run([textarea('t', 'T', 20)], { t: 'a\r\nb' });
    expect(r.value.t).toBe('a\nb');
    expect(run([textarea('t', 'T', 3)], { t: 'abcd' }).issues).toHaveLength(1);
    expect(run([textarea('t', 'T', 30)], { t: '<img src=x>' }).issues).toHaveLength(1);
  });

  it('richtext validates the subset and length', () => {
    const f = [richtext('r', 'R', 30)];
    expect(run(f, { r: '**ok**' }).issues).toEqual([]);
    expect(run(f, { r: '<i>x</i>' }).issues).toHaveLength(1);
    expect(run(f, { r: 'x'.repeat(31) }).issues).toHaveLength(1);
  });

  it('image: url rules, alt, required, unknown keys', () => {
    const f = [image('i', 'I', { required: true })];
    expect(run(f, { i: { url: '/images/a.jpg', alt: 'A' } }).value).toEqual({ i: { url: '/images/a.jpg', alt: 'A' } });
    expect(run(f, {}).issues[0].message).toBe('is required');
    expect(run(f, { i: { url: 'http://x.com/a.png', alt: '' } }).issues[0].path).toBe('data.i.url');
    expect(run(f, { i: { url: 'data:image/png;base64,AA', alt: '' } }).issues).toHaveLength(1);
    expect(run(f, { i: { url: '/images/a.jpg', alt: 'x'.repeat(201) } }).issues[0].path).toBe('data.i.alt');
    expect(run(f, { i: { url: '/images/a.jpg', alt: '', extra: 1 } }).issues[0].path).toBe('data.i.extra');
    expect(run([image('i', 'I')], {}).value).toEqual({ i: { url: '', alt: '' } });
    expect(run(f, { i: 'x' }).issues[0].message).toMatch(/object/);
  });

  it('link: relative/https only, label+href together, required', () => {
    const f = [link('l', 'L', { required: true }), link('o', 'O')];
    expect(run(f, { l: { label: 'Go', href: '/x' } }).value).toEqual({ l: { label: 'Go', href: '/x' }, o: { label: '', href: '' } });
    expect(run(f, { l: { label: 'Go', href: 'javascript:alert(1)' } }).issues[0].path).toBe('data.l.href');
    expect(run(f, { l: { label: 'Go', href: 'http://a.b' } }).issues).toHaveLength(1);
    expect(run(f, { l: { label: 'Go', href: 'data:text/html,x' } }).issues).toHaveLength(1);
    expect(run(f, {}).issues.map((i) => i.path)).toEqual(['data.l']);
    expect(run(f, { l: { label: 'Go', href: '/x' }, o: { label: 'only label', href: '' } }).issues[0].path).toBe('data.o.href');
    expect(run(f, { l: { label: '<b>', href: '/x' } }).issues[0].path).toBe('data.l.label');
    expect(run(f, { l: { label: 'Go', href: '/x', target: '_blank' } }).issues[0].path).toBe('data.l.target');
  });

  it('toggle, number, select, color', () => {
    const f = [toggle('t', 'T'), number('n', 'N', 1, 5), select('s', 'S', [{ value: 'a', label: 'A' }], { required: true }), color('c', 'C')];
    expect(run(f, { t: true, n: 3, s: 'a', c: '#ABCDEF' }).value).toEqual({ t: true, n: 3, s: 'a', c: '#abcdef' });
    expect(run(f, { t: 'yes', n: 3, s: 'a' }).issues[0].path).toBe('data.t');
    expect(run(f, { n: 9, s: 'a' }).issues[0].message).toMatch(/between 1 and 5/);
    expect(run(f, { n: '3', s: 'a' }).issues[0].message).toBe('must be a number');
    expect(run(f, { n: NaN, s: 'a' }).issues).toHaveLength(1);
    expect(run(f, { n: 2, s: 'zzz' }).issues[0].message).toMatch(/one of/);
    expect(run(f, { n: 2 }).issues[0]).toEqual({ path: 'data.s', message: 'is required' });
    expect(run(f, { n: 2, s: 'a', c: 'red' }).issues[0].path).toBe('data.c');
    expect(run(f, { n: 2, s: 'a', c: '#fff' }).issues).toHaveLength(1);
  });

  it('list: min/max, item validation, stable ids, duplicate ids, unknown item fields', () => {
    const f = [list('items', 'Items', 'Item', 2, [text('t', 'T', 5, { required: true })], { min: 1 })];
    const ok = run(f, { items: [{ id: 'keep', t: 'a' }, { t: 'b' }] });
    expect(ok.issues).toEqual([]);
    expect(ok.value.items).toEqual([{ id: 'keep', t: 'a' }, { id: expect.stringMatching(/^gen\d+$/), t: 'b' }]);
    expect(run(f, { items: [] }).issues[0].message).toMatch(/at least 1/);
    expect(run(f, { items: [{ t: 'a' }, { t: 'b' }, { t: 'c' }] }).issues[0].message).toMatch(/at most 2/);
    expect(run(f, { items: [{ t: '' }] }).issues[0].path).toBe('data.items[0].t');
    expect(run(f, { items: [{ t: 'a', zzz: 1 }] }).issues[0].path).toBe('data.items[0].zzz');
    const dup = run(f, { items: [{ id: 'x', t: 'a' }, { id: 'x', t: 'b' }] });
    const ids = (dup.value.items as { id: string }[]).map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
    const badId = run(f, { items: [{ id: '<script>', t: 'a' }] });
    expect((badId.value.items as { id: string }[])[0].id).toMatch(/^gen/);
    expect(run(f, { items: 'nope' }).issues[0].message).toBe('must be a list');
    expect(run(f, { items: ['x'] }).issues[0].message).toBe('must be an object');
    expect(run(f, {}).issues[0].message).toMatch(/at least 1/);
  });

  it('group nests and reports nested paths', () => {
    const f = [group('g', 'G', [text('a', 'A', 3, { required: true }), group('h', 'H', [toggle('x', 'X')])])];
    expect(run(f, { g: { a: 'ok', h: { x: true } } }).value).toEqual({ g: { a: 'ok', h: { x: true } } });
    expect(run(f, {}).issues).toEqual([{ path: 'data.g.a', message: 'is required' }]);
    expect(run(f, { g: { a: 'ok', q: 1 } }).issues[0].path).toBe('data.g.q');
    expect(run(f, { g: 'x' }).issues[0].message).toMatch(/object/);
  });

  it('rejects a non-object payload', () => {
    expect(run([text('a', 'A', 3)], 'x').issues[0].message).toMatch(/object/);
    expect(run([text('a', 'A', 3)], null).issues).toHaveLength(1);
    expect(run([text('a', 'A', 3)], []).issues).toHaveLength(1);
  });

  it('caps the number of reported issues', () => {
    const f = [list('items', 'I', 'I', 500, [text('t', 'T', 1, { required: true })])];
    const items = Array.from({ length: 300 }, () => ({}));
    expect(run(f, { items }).issues.length).toBeLessThanOrEqual(100);
  });
});

describe('document payloads', () => {
  const sectionA: SectionSchema = { type: 'a', label: 'A', fixed: true, single: true, canDisable: false, fields: [text('t', 'T', 10, { required: true })] };
  const sectionB: SectionSchema = { type: 'b', label: 'B', canDisable: true, fields: [toggle('x', 'X')] };
  const sectionC: SectionSchema = { type: 'c', label: 'C', single: true, fields: [] };
  const pageSchema: DocumentSchema = { key: 'page.t', label: 'T', kind: 'page', sections: { allowed: ['a', 'b', 'c'], default: ['a'] } };
  const map = { a: sectionA, b: sectionB, c: sectionC };
  const v = (raw: unknown) => validateDocumentPayload(pageSchema, map, raw, { idGenerator });

  it('accepts a valid page and keeps order', () => {
    const r = v({ sections: [{ id: 's1', type: 'a', enabled: true, data: { t: 'x' } }, { id: 's2', type: 'b', enabled: false, data: {} }] });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      sections: [
        { id: 's1', type: 'a', enabled: true, data: { t: 'x' } },
        { id: 's2', type: 'b', enabled: false, data: { x: false } },
      ],
    });
  });
  it('defaults enabled to true', () => {
    const r = v({ sections: [{ id: 's1', type: 'a', data: { t: 'x' } }] });
    expect((r.value as { sections: { enabled: boolean }[] }).sections[0].enabled).toBe(true);
  });
  it('rejects bad shapes', () => {
    expect(v(null).ok).toBe(false);
    expect(v({}).issues[0].path).toBe('sections');
    expect(v({ sections: [], data: {} }).issues.map((i) => i.path)).toContain('data');
    expect(v({ sections: 'x' }).ok).toBe(false);
    expect(v({ sections: [{ id: 's1', type: 'zzz', data: {} }] }).issues[0].path).toBe('sections[0].type');
    expect(v({ sections: [{ id: 's1', type: 'a', data: { t: 'x' }, hack: 1 }] }).issues[0].path).toBe('sections[0].hack');
    expect(v({ sections: ['x'] }).issues[0].message).toMatch(/object/);
  });
  it('enforces ids, uniqueness, enabled type', () => {
    expect(v({ sections: [{ id: 'bad id!', type: 'a', data: { t: 'x' } }] }).issues[0].path).toBe('sections[0].id');
    const dup = v({ sections: [{ id: 's', type: 'a', data: { t: 'x' } }, { id: 's', type: 'b', data: {} }] });
    expect(dup.issues[0]).toEqual({ path: 'sections[1].id', message: 'must be unique' });
    expect(v({ sections: [{ id: 's', type: 'a', enabled: 'no', data: { t: 'x' } }] }).issues[0].path).toBe('sections[0].enabled');
  });
  it('enforces fixed, single and canDisable:false', () => {
    expect(v({ sections: [{ id: 's', type: 'b', data: {} }] }).issues[0].message).toMatch(/required and cannot be removed/);
    expect(v({ sections: [{ id: 's', type: 'a', enabled: false, data: { t: 'x' } }] }).issues[0].message).toMatch(/cannot be disabled/);
    const twice = v({ sections: [{ id: 'a1', type: 'a', data: { t: 'x' } }, { id: 'a2', type: 'a', data: { t: 'y' } }] });
    expect(twice.issues.map((i) => i.message).join()).toMatch(/only be used once/);
    expect(v({ sections: [{ id: 'a1', type: 'a', data: { t: 'x' } }, { id: 'b1', type: 'b', data: {} }, { id: 'b2', type: 'b', data: {} }] }).ok).toBe(true);
  });
  it('validates section data and reports full paths', () => {
    const r = v({ sections: [{ id: 's', type: 'a', data: { t: '' } }] });
    expect(r.issues).toEqual([{ path: 'sections[0].data.t', message: 'is required' }]);
    expect(v({ sections: [{ id: 's', type: 'a', data: { t: 'x', y: 1 } }] }).issues[0].path).toBe('sections[0].data.y');
  });
  it('limits the number of sections', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ id: `s${i}`, type: 'b', data: {} }));
    expect(v({ sections: many }).issues[0].message).toMatch(/at most 40/);
  });

  it('global documents take only data', () => {
    const globalSchema: DocumentSchema = { key: 'global.t', label: 'G', kind: 'global', fields: [text('t', 'T', 5, { required: true })] };
    expect(validateDocumentPayload(globalSchema, {}, { data: { t: 'ok' } }).value).toEqual({ data: { t: 'ok' } });
    expect(validateDocumentPayload(globalSchema, {}, { data: { t: '' } }).ok).toBe(false);
    expect(validateDocumentPayload(globalSchema, {}, { sections: [] }).issues.map((i) => i.path)).toContain('sections');
    expect(validateDocumentPayload(globalSchema, {}, { data: { t: 'ok' }, extra: 1 }).ok).toBe(false);
    expect(validateDocumentPayload(globalSchema, {}, {}).ok).toBe(false);
  });
});
