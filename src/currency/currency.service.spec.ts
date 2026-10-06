import type { ConfigService } from '@nestjs/config';
import type { SettingsService } from '../admin/settings/settings.service';
import { CurrencyService } from './currency.service';
import type { FxProvider } from './fx-provider';

function build(opts: { stored?: any; provider?: Partial<FxProvider> } = {}) {
  const store: any = {
    findOne: () => ({ lean: () => ({ exec: () => Promise.resolve(opts.stored ?? null) }) }),
    findOneAndUpdate: jest.fn(() => ({ exec: () => Promise.resolve(undefined) })),
  };
  const provider: FxProvider = {
    source: 'Test',
    attribution: 'Rates by Test',
    fetchRates: () => Promise.resolve({ rates: { AED: 1, USD: 0.27 }, providerUpdatedAt: new Date() }),
    ...opts.provider,
  };
  const config = {
    get: (key: string, fallback?: unknown) => ({ NODE_ENV: 'test' })[key as 'NODE_ENV'] ?? fallback,
  } as unknown as ConfigService;
  const settings = { peekCommerce: () => ({ fxMarkupPercent: 0 }) } as unknown as SettingsService;
  return { service: new CurrencyService(store, provider, settings, config), store };
}

describe('CurrencyService', () => {
  it('without any rates answers AED only and flags stale', async () => {
    const { service } = build();
    await service.onModuleInit();
    expect(service.hasRates).toBe(false);
    expect(service.view()).toMatchObject({
      base: 'AED',
      updatedAt: null,
      fetchedAt: null,
      stale: true,
      rates: { AED: 1 },
    });
    expect(service.view().currencies).toHaveLength(50);
  });

  it('keeps previous rates when a refresh fails or returns bad data', async () => {
    const stored = {
      rates: { AED: 1, USD: 0.3 },
      providerUpdatedAt: new Date(),
      fetchedAt: new Date(),
    };
    const { service, store } = build({
      stored,
      provider: {
        fetchRates: () => {
          return Promise.reject(new Error('boom'));
        },
      },
    });
    await service.onModuleInit();
    await expect(service.refresh()).resolves.toBe(false);
    expect(service.rates.USD).toBe(0.3);
    expect(store.findOneAndUpdate).not.toHaveBeenCalled();
    expect(service.view().stale).toBe(false);
  });

  it('stores and serves fresh rates on refresh', async () => {
    const { service, store } = build();
    await expect(service.refresh()).resolves.toBe(true);
    expect(service.rates.USD).toBe(0.27);
    expect(store.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(service.view().source).toBe('Test');
  });

  it('marks very old rates as stale while still serving them', async () => {
    const old = new Date(Date.now() - 100 * 3_600_000);
    const { service } = build({ stored: { rates: { AED: 1, USD: 0.3 }, providerUpdatedAt: old, fetchedAt: old } });
    await service.onModuleInit();
    expect(service.view().stale).toBe(true);
    expect(service.rates.USD).toBe(0.3);
  });
});
