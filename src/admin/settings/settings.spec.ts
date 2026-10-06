import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SettingsService, mergeDefaults } from './settings.service';
import { unknownPlaceholders, validateSettings } from './settings.dto';

function messageOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    const e = error as HttpException;
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
    return (e.getResponse() as { message: string }).message;
  }
}

describe('validateSettings', () => {
  it('accepts a valid commerce group and returns a plain object', () => {
    const body = { taxPercent: 7.5, holdMinutes: 15, fxMarkupPercent: 1, bookingCutoffHours: 2 };
    expect(validateSettings('commerce', body)).toEqual(body);
  });

  it.each([
    [{ taxPercent: 31, holdMinutes: 10, fxMarkupPercent: 0, bookingCutoffHours: 0 }, 'taxPercent'],
    [{ taxPercent: -1, holdMinutes: 10, fxMarkupPercent: 0, bookingCutoffHours: 0 }, 'taxPercent'],
    [{ taxPercent: 5, holdMinutes: 0, fxMarkupPercent: 0, bookingCutoffHours: 0 }, 'holdMinutes'],
    [{ taxPercent: 5, holdMinutes: 121, fxMarkupPercent: 0, bookingCutoffHours: 0 }, 'holdMinutes'],
    [{ taxPercent: 5, holdMinutes: 1.5, fxMarkupPercent: 0, bookingCutoffHours: 0 }, 'holdMinutes'],
    [{ taxPercent: 5, holdMinutes: 10, fxMarkupPercent: 11, bookingCutoffHours: 0 }, 'fxMarkupPercent'],
    [{ taxPercent: 5, holdMinutes: 10, fxMarkupPercent: 0, bookingCutoffHours: 721 }, 'bookingCutoffHours'],
    [{ taxPercent: '5', holdMinutes: 10, fxMarkupPercent: 0, bookingCutoffHours: 0 }, 'taxPercent'],
    [{ holdMinutes: 10, fxMarkupPercent: 0, bookingCutoffHours: 0 }, 'taxPercent'],
  ])('rejects invalid commerce values %#', (body, field) => {
    expect(messageOf(() => validateSettings('commerce', body))).toContain(field);
  });

  it('rejects unknown keys and non-objects', () => {
    expect(
      messageOf(() =>
        validateSettings('commerce', {
          taxPercent: 5,
          holdMinutes: 10,
          fxMarkupPercent: 0,
          bookingCutoffHours: 0,
          role: 'admin',
        }),
      ),
    ).toContain('role');
    expect(messageOf(() => validateSettings('commerce', null))).toBeTruthy();
    expect(messageOf(() => validateSettings('commerce', [1]))).toBeTruthy();
  });

  it('validates general: email, phone and social URLs', () => {
    const ok = {
      siteName: 'Tourvex',
      supportEmail: 'help@tourvex.com',
      supportPhone: '+971 4 123 4567',
      address: 'Dubai',
      socials: { instagram: 'https://instagram.com/tourvex', facebook: '' },
    };
    expect(validateSettings('general', ok)).toEqual(ok);
    expect(messageOf(() => validateSettings('general', { ...ok, supportEmail: 'nope' }))).toContain('supportEmail');
    expect(messageOf(() => validateSettings('general', { ...ok, siteName: '' }))).toContain('siteName');
    expect(messageOf(() => validateSettings('general', { ...ok, supportPhone: 'call me' }))).toContain('supportPhone');
    expect(
      messageOf(() => validateSettings('general', { ...ok, socials: { x: 'javascript:alert(1)' } })),
    ).toContain('socials.x');
  });

  const template = { subject: 'Booking {{bookingRef}}', body: 'Hi {{ customerName }}, see {{voucherUrl}}' };
  const notifications = {
    senderName: 'Tourvex',
    templates: { bookingConfirmation: template, voucher: template, cancellation: template },
  };

  it('accepts whitelisted placeholders in notification templates', () => {
    expect(validateSettings('notifications', notifications)).toEqual(notifications);
  });

  it('rejects unknown or malformed placeholders and oversize text', () => {
    const bad = (t: Record<string, string>) => ({
      ...notifications,
      templates: { ...notifications.templates, voucher: t },
    });
    expect(messageOf(() => validateSettings('notifications', bad({ subject: 'x {{password}}', body: 'b' })))).toContain(
      'templates.voucher.subject',
    );
    expect(messageOf(() => validateSettings('notifications', bad({ subject: 's', body: 'Hi {{customerName' })))).toContain(
      'templates.voucher.body',
    );
    expect(messageOf(() => validateSettings('notifications', bad({ subject: 's'.repeat(151), body: 'b' })))).toContain(
      'templates.voucher.subject',
    );
    expect(unknownPlaceholders('{{bookingRef}} {{ nope }} {{x.y}}')).toEqual(['nope', 'x.y']);
  });

  it('validates homepage sections: shape, order kept, unique ids', () => {
    const sections = [
      { id: 'hero', enabled: true },
      { id: 'visas', enabled: false },
    ];
    expect(validateSettings('homepage', { sections })).toEqual({ sections });
    expect(messageOf(() => validateSettings('homepage', { sections: [{ id: 'Hero Section', enabled: true }] }))).toContain('sections');
    expect(messageOf(() => validateSettings('homepage', { sections: [{ id: 'a', enabled: 'yes' }] }))).toContain('enabled');
    expect(messageOf(() => validateSettings('homepage', { sections: [{ id: 'a', enabled: true }, { id: 'a', enabled: false }] }))).toContain('unique');
  });
});

describe('mergeDefaults', () => {
  it('overlays stored values recursively and takes arrays as stored', () => {
    expect(
      mergeDefaults(
        { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] },
        { nested: { y: 3 }, list: [9] },
      ),
    ).toEqual({ a: 1, nested: { x: 1, y: 3 }, list: [9] });
  });
});

describe('SettingsService', () => {
  function build(stored: Record<string, any> = {}, env: Record<string, unknown> = {}) {
    const findOne = jest.fn((filter: { group: string }) => ({
      lean: () => ({ exec: () => Promise.resolve(stored[filter.group] ?? null) }),
    }));
    const store = { findOne } as any;
    const config = {
      get: (key: string, fallback?: unknown) => env[key] ?? fallback,
    } as unknown as ConfigService;
    return { service: new SettingsService(store, config), findOne };
  }

  it('falls back to the env-driven defaults when nothing is stored', async () => {
    const { service } = build({}, { CHECKOUT_TAX_PERCENT: 9, CHECKOUT_HOLD_MINUTES: 20, FX_MARKUP_PERCENT: 2 });
    await expect(service.getCommerce()).resolves.toMatchObject({
      taxPercent: 9,
      holdMinutes: 20,
      fxMarkupPercent: 2,
    });
  });

  it('uses the stored value over env and caches it for 60 seconds', async () => {
    const { service, findOne } = build(
      { commerce: { values: { taxPercent: 12, holdMinutes: 30, fxMarkupPercent: 3, bookingCutoffHours: 4 } } },
      { CHECKOUT_TAX_PERCENT: 5 },
    );
    expect((await service.getCommerce()).taxPercent).toBe(12);
    expect((await service.getCommerce()).holdMinutes).toBe(30);
    expect(findOne).toHaveBeenCalledTimes(1);

    jest.useFakeTimers();
    try {
      jest.setSystemTime(Date.now() + SettingsService.TTL_MS + 1);
      await service.getCommerce();
      expect(findOne).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('peekCommerce returns env defaults before the first load and the stored value after', async () => {
    const { service } = build({ commerce: { values: { fxMarkupPercent: 4 } } }, { FX_MARKUP_PERCENT: 1 });
    expect(service.peekCommerce().fxMarkupPercent).toBe(1);
    await service.getCommerce();
    expect(service.peekCommerce().fxMarkupPercent).toBe(4);
  });

  it('serves defaults instead of failing when the database read fails', async () => {
    const store = {
      findOne: () => ({ lean: () => ({ exec: () => Promise.reject(new Error('down')) }) }),
    } as any;
    const service = new SettingsService(store, { get: (_k: string, d: unknown) => d } as any);
    await expect(service.getCommerce()).resolves.toMatchObject({ taxPercent: 5, holdMinutes: 10 });
  });

  it('public settings expose only safe fields and drop empty socials', async () => {
    const { service } = build({
      general: {
        values: {
          siteName: 'Tourvex',
          supportEmail: 'help@tourvex.com',
          supportPhone: '+971',
          address: 'secret street',
          socials: { instagram: 'https://instagram.com/x', facebook: '' },
        },
      },
    });
    const view = await service.getPublic();
    expect(view).toEqual({
      siteName: 'Tourvex',
      supportEmail: 'help@tourvex.com',
      supportPhone: '+971',
      socials: { instagram: 'https://instagram.com/x' },
    });
    expect(JSON.stringify(view)).not.toContain('secret street');
  });

  it('answers 404 for an unknown group', async () => {
    const { service } = build();
    await expect(service.view('nope')).rejects.toMatchObject({ status: 404 });
  });
});
