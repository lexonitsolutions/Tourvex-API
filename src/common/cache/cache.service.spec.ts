import type { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

/** Config with no Redis: the service runs on its in-memory store. */
const configWith = (values: Record<string, string> = {}) =>
  ({ get: (key: string, fallback?: unknown) => values[key] ?? fallback }) as unknown as ConfigService;

describe('CacheService (in-memory mode)', () => {
  it('runs the loader once and serves the cached value afterwards', async () => {
    const cache = new CacheService(configWith());
    const loader = jest.fn(async () => ({ n: 1 }));
    expect(await cache.wrap('ns', 'k', 60, loader)).toEqual({ n: 1 });
    expect(await cache.wrap('ns', 'k', 60, loader)).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keeps keys and namespaces apart', async () => {
    const cache = new CacheService(configWith());
    await cache.wrap('a', 'k', 60, async () => 'a-k');
    expect(await cache.wrap('a', 'other', 60, async () => 'a-other')).toBe('a-other');
    expect(await cache.wrap('b', 'k', 60, async () => 'b-k')).toBe('b-k');
  });

  it('hands every caller its own copy, so editing a response cannot corrupt the cache', async () => {
    const cache = new CacheService(configWith());
    const first = await cache.wrap<{ price: number }>('ns', 'k', 60, async () => ({ price: 100 }));
    first.price = 999; // what the currency interceptor does to a response
    const second = await cache.wrap<{ price: number }>('ns', 'k', 60, async () => ({ price: -1 }));
    expect(second.price).toBe(100);
  });

  it('shares one loader call between concurrent misses', async () => {
    const cache = new CacheService(configWith());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const loader = jest.fn(async () => {
      await gate;
      return 'value';
    });
    const calls = [cache.wrap('ns', 'k', 60, loader), cache.wrap('ns', 'k', 60, loader), cache.wrap('ns', 'k', 60, loader)];
    release();
    expect(await Promise.all(calls)).toEqual(['value', 'value', 'value']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('never caches a failure', async () => {
    const cache = new CacheService(configWith());
    const loader = jest.fn().mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce('ok');
    await expect(cache.wrap('ns', 'k', 60, loader)).rejects.toThrow('not found');
    expect(await cache.wrap('ns', 'k', 60, loader)).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('expires entries after their lifetime', async () => {
    jest.useFakeTimers();
    try {
      const cache = new CacheService(configWith());
      const loader = jest.fn(async () => 'v');
      await cache.wrap('ns', 'k', 10, loader);
      jest.advanceTimersByTime(11_000);
      await cache.wrap('ns', 'k', 10, loader);
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidate drops the whole namespace and nothing else', async () => {
    const cache = new CacheService(configWith());
    const catalog = jest.fn(async () => 'c');
    const cms = jest.fn(async () => 'm');
    await cache.wrap('catalog', 'list', 60, catalog);
    await cache.wrap('catalog', 'detail', 60, catalog);
    await cache.wrap('cms', 'home', 60, cms);
    await cache.invalidate('catalog');
    await cache.wrap('catalog', 'list', 60, catalog);
    await cache.wrap('cms', 'home', 60, cms);
    expect(catalog).toHaveBeenCalledTimes(3); // list, detail, then list again
    expect(cms).toHaveBeenCalledTimes(1);
  });

  it('is a transparent pass-through when disabled', async () => {
    const cache = new CacheService(configWith({ CACHE_ENABLED: 'false' }));
    const loader = jest.fn(async () => 'v');
    await cache.wrap('ns', 'k', 60, loader);
    await cache.wrap('ns', 'k', 60, loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.mode).toBe('disabled');
  });

  it('is off by default when NODE_ENV=test', () => {
    expect(new CacheService(configWith({ NODE_ENV: 'test' })).mode).toBe('disabled');
    expect(new CacheService(configWith({ NODE_ENV: 'test', CACHE_ENABLED: 'true' })).mode).toBe('memory');
  });

  it('reports memory mode without Redis', () => {
    expect(new CacheService(configWith()).mode).toBe('memory');
  });

  it('keeps working when Redis is configured but unreachable', async () => {
    // Nothing listens on this port: every Redis call must degrade to the in-memory store, never throw.
    const cache = new CacheService(configWith({ REDIS_URL: 'redis://127.0.0.1:1' }));
    const loader = jest.fn(async () => 'v');
    try {
      expect(await cache.wrap('ns', 'k', 60, loader)).toBe('v');
      expect(await cache.wrap('ns', 'k', 60, loader)).toBe('v');
      expect(loader).toHaveBeenCalledTimes(1);
      await expect(cache.invalidate('ns')).resolves.toBeUndefined();
      expect(cache.mode).toBe('memory');
    } finally {
      await cache.onModuleDestroy();
    }
  });
});
