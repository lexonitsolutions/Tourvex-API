import { createHmac } from 'node:crypto';
import { AuditService, hashIp, normalizeRequestId } from './audit.service';
import { diffChanges, REDACTED, redactChange, redactChanges, redactValue } from './redact';

describe('audit redaction', () => {
  it.each(['password', 'newPassword', 'apiToken', 'clientSecret', 'cardNumber', 'stripeKey', 'API_KEY'])(
    'masks both sides of a change to %s',
    (field) => {
      expect(redactChange({ field, from: 'old', to: 'new' })).toEqual({
        field,
        from: REDACTED,
        to: REDACTED,
      });
    },
  );

  it('keeps ordinary fields', () => {
    expect(redactChange({ field: 'roles', from: ['sales'], to: ['finance'] })).toEqual({
      field: 'roles',
      from: ['sales'],
      to: ['finance'],
    });
  });

  it('masks sensitive keys nested in objects and arrays', () => {
    expect(
      redactValue({
        name: 'x',
        auth: { accessToken: 'abc', list: [{ secretValue: 's', ok: 1 }] },
        payment: { cardLast4: '4242' },
      }),
    ).toEqual({
      name: 'x',
      auth: { accessToken: REDACTED, list: [{ secretValue: REDACTED, ok: 1 }] },
      payment: { cardLast4: REDACTED },
    });
  });

  it('bounds long strings and deep structures', () => {
    expect((redactValue('a'.repeat(5000)) as string).length).toBeLessThan(1100);
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    expect(JSON.stringify(redactValue(deep))).toContain('[TRUNCATED]');
    expect(redactChanges(Array.from({ length: 500 }, (_, i) => ({ field: `f${i}`, from: 1, to: 2 })))).toHaveLength(200);
  });

  it('diffs only changed keys', () => {
    expect(diffChanges({ a: 1, b: [1], c: 'x' }, { a: 1, b: [2], c: 'x', d: 'new' })).toEqual([
      { field: 'b', from: [1], to: [2] },
      { field: 'd', from: null, to: 'new' },
    ]);
  });
});

describe('audit ip hashing and request ids', () => {
  it('stores a salted hash, never the address', () => {
    const hash = hashIp('203.0.113.9', 'salt-a');
    expect(hash).toBe(createHmac('sha256', 'salt-a').update('203.0.113.9').digest('hex'));
    expect(hash).not.toContain('203.0.113.9');
    expect(hashIp('203.0.113.9', 'salt-b')).not.toBe(hash);
    expect(hashIp(undefined, 'salt-a')).toBeUndefined();
  });

  it('accepts sane request ids and replaces unsafe ones', () => {
    expect(normalizeRequestId('req-123_a.b:c')).toBe('req-123_a.b:c');
    expect(normalizeRequestId('bad id\n<script>')).toMatch(/^[0-9a-f-]{36}$/);
    expect(normalizeRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('AuditService.record', () => {
  const actor = { sub: '665f1c2b9a1e4b0012345678', email: 'a@example.com', roles: ['admin'] };

  it('writes redacted changes and a hashed ip', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuditService({ create } as any, { get: (k: string) => (k === 'AUDIT_IP_SALT' ? 'salt' : undefined) } as any);
    await service.record({
      actor,
      action: 'x.update',
      entityType: 'x',
      entityId: '1',
      changes: [{ field: 'apiKey', from: 'a', to: 'b' }],
      ip: '10.0.0.1',
    });
    const written = create.mock.calls[0][0];
    expect(written.changes).toEqual([{ field: 'apiKey', from: REDACTED, to: REDACTED }]);
    expect(written.ip).toBe(hashIp('10.0.0.1', 'salt'));
    expect(JSON.stringify(written)).not.toContain('10.0.0.1');
  });

  it('never throws when the write fails', async () => {
    const service = new AuditService({ create: jest.fn().mockRejectedValue(new Error('db down')) } as any, { get: () => undefined } as any);
    await expect(
      service.record({ actor, action: 'x.update', entityType: 'x' }),
    ).resolves.toBeUndefined();
  });
});
