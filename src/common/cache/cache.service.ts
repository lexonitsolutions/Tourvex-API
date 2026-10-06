import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

type MemoryEntry = { value: string; expiresAt: number };

const PREFIX = 'tvx:';
const MEMORY_LIMIT = 500;

/**
 * Read-through cache for public, user-independent data. Redis when `REDIS_URL` is set and reachable,
 * otherwise a small in-process store, so a Redis outage (or no Redis at all) never breaks a request:
 * every failure degrades to "cache miss" and the loader runs.
 *
 * Values are stored as JSON, so every caller gets its own copy (the currency interceptor edits responses in
 * place). Callers must therefore only cache JSON-safe results that are fine to share between visitors.
 * Concurrent misses for one key share a single loader call, so a cold cache cannot stampede the database.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly enabled: boolean;
  private readonly redis?: Redis;
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly inflight = new Map<string, Promise<string | undefined>>();
  private lastWarningAt = 0;

  constructor(config: ConfigService) {
    const isTest = config.get<string>('NODE_ENV') === 'test';
    // Tests assert on fresh data right after writes, so caching is opt-in there.
    this.enabled = config.get<string>('CACHE_ENABLED', isTest ? 'false' : 'true') === 'true';
    const url = config.get<string>('REDIS_URL');
    if (this.enabled && url) {
      this.redis = new Redis(url, {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
        commandTimeout: 500,
        retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
      });
      this.redis.on('error', (error) => this.warn(`Redis unavailable, using the in-memory cache: ${error.message}`));
      this.redis.on('ready', () => this.logger.log('Redis cache connected'));
    }
  }

  /** `redis` | `memory` | `disabled`: what is serving reads right now (for the health check). */
  get mode(): 'redis' | 'memory' | 'disabled' {
    if (!this.enabled) return 'disabled';
    return this.redis?.status === 'ready' ? 'redis' : 'memory';
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  /** Cached value for `key`, or runs `loader` and keeps its result for `ttlSeconds`. Loader errors are never cached. */
  async wrap<T>(namespace: string, key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    if (!this.enabled) return loader();
    const fullKey = `${PREFIX}${namespace}:${key}`;
    const hit = await this.read(fullKey);
    if (hit !== undefined) return JSON.parse(hit) as T;

    const pending = this.inflight.get(fullKey);
    if (pending) {
      const shared = await pending;
      return (shared === undefined ? undefined : JSON.parse(shared)) as T;
    }

    const load = (async () => {
      const serialized = JSON.stringify(await loader());
      if (serialized !== undefined) await this.write(fullKey, serialized, ttlSeconds);
      return serialized;
    })();
    this.inflight.set(fullKey, load);
    try {
      const serialized = await load;
      return (serialized === undefined ? undefined : JSON.parse(serialized)) as T;
    } finally {
      this.inflight.delete(fullKey);
    }
  }

  /** Drops every entry of a namespace (call after the data behind it changed). */
  async invalidate(...namespaces: string[]): Promise<void> {
    if (!this.enabled) return;
    for (const namespace of namespaces) {
      const prefix = `${PREFIX}${namespace}:`;
      for (const key of [...this.memory.keys()]) if (key.startsWith(prefix)) this.memory.delete(key);
      if (this.redis?.status !== 'ready') continue;
      try {
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
          cursor = next;
          if (keys.length) await this.redis.unlink(...keys);
        } while (cursor !== '0');
      } catch (error) {
        this.warn(`Cache invalidation failed for "${namespace}": ${(error as Error).message}`);
      }
    }
  }

  private async read(key: string): Promise<string | undefined> {
    if (this.redis?.status === 'ready') {
      try {
        const value = await this.redis.get(key);
        return value === null ? undefined : value;
      } catch (error) {
        this.warn(`Redis read failed: ${(error as Error).message}`);
      }
    }
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private async write(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.redis?.status === 'ready') {
      try {
        await this.redis.set(key, value, 'EX', ttlSeconds);
        return;
      } catch (error) {
        this.warn(`Redis write failed: ${(error as Error).message}`);
      }
    }
    if (this.memory.size >= MEMORY_LIMIT) this.memory.delete(this.memory.keys().next().value as string);
    this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** At most one warning a minute, so an outage cannot flood the log. */
  private warn(message: string) {
    const now = Date.now();
    if (now - this.lastWarningAt < 60_000) return;
    this.lastWarningAt = now;
    this.logger.warn(message);
  }
}
