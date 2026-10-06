import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SettingsService } from '../admin/settings/settings.service';
import { isStale, type RateMap } from './currency.conversion';
import {
  BASE_CURRENCY,
  DEFAULT_MAX_AGE_HOURS,
  DEFAULT_REFRESH_HOURS,
  FX_PROVIDER,
  SUPPORTED_CURRENCIES,
} from './currency.constants';
import type { FxProvider } from './fx-provider';
import { FxRate } from './schemas/fx-rate.schema';

export interface RatesView {
  base: string;
  updatedAt: string | null;
  fetchedAt: string | null;
  stale: boolean;
  source: string;
  attribution: string;
  rates: Record<string, number>;
  currencies: string[];
}

interface Loaded {
  rates: Record<string, number>;
  providerUpdatedAt: Date;
  fetchedAt: Date;
}

@Injectable()
export class CurrencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CurrencyService.name);
  private current: Loaded | null = null;
  private timer?: NodeJS.Timeout;
  private refreshing = false;

  private readonly refreshHours: number;
  private readonly maxAgeHours: number;
  private readonly isTest: boolean;

  constructor(
    @InjectModel(FxRate.name) private readonly store: Model<FxRate>,
    @Inject(FX_PROVIDER) private readonly provider: FxProvider,
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    this.refreshHours = config.get<number>('FX_REFRESH_HOURS', DEFAULT_REFRESH_HOURS);
    this.maxAgeHours = config.get<number>('FX_MAX_AGE_HOURS', DEFAULT_MAX_AGE_HOURS);
    this.isTest = config.get<string>('NODE_ENV') === 'test';
  }

  /**
   * Markup applied to non-AED conversions. Read through SettingsService (admin-editable, env
   * FX_MARKUP_PERCENT is the default). Synchronous: it is the last known value, refreshed in the
   * background at most every 60 s.
   */
  get markupPercent(): number {
    return this.settings.peekCommerce().fxMarkupPercent;
  }

  async onModuleInit() {
    await this.loadFromStore();
    if (this.isTest) return;
    const fetchedAt = this.current?.fetchedAt.getTime() ?? 0;
    if (Date.now() - fetchedAt > this.refreshHours * 3_600_000) void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshHours * 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Latest rates held in memory; never touches the network or the database. */
  get rates(): RateMap {
    return this.current?.rates ?? { [BASE_CURRENCY]: 1 };
  }

  get hasRates(): boolean {
    return this.current !== null;
  }

  get updatedAt(): Date | null {
    return this.current?.providerUpdatedAt ?? null;
  }

  view(now = new Date()): RatesView {
    const current = this.current;
    return {
      base: BASE_CURRENCY,
      updatedAt: current?.providerUpdatedAt.toISOString() ?? null,
      fetchedAt: current?.fetchedAt.toISOString() ?? null,
      stale: isStale(current?.providerUpdatedAt ?? null, now, this.maxAgeHours),
      source: this.provider.source,
      attribution: this.provider.attribution,
      rates: { ...this.rates },
      currencies: [...SUPPORTED_CURRENCIES],
    };
  }

  /** Fetches, validates and persists; on any failure the previous rates are kept. Never throws. */
  async refresh(): Promise<boolean> {
    if (this.refreshing) return false;
    this.refreshing = true;
    try {
      const snapshot = await this.provider.fetchRates();
      const fetchedAt = new Date();
      await this.store
        .findOneAndUpdate(
          { base: BASE_CURRENCY },
          {
            $set: {
              rates: snapshot.rates,
              providerUpdatedAt: snapshot.providerUpdatedAt,
              fetchedAt,
              source: this.provider.source,
            },
          },
          { upsert: true },
        )
        .exec()
        .catch(() => this.logger.warn('Could not persist FX rates; using the in-memory copy'));
      this.current = { rates: snapshot.rates, providerUpdatedAt: snapshot.providerUpdatedAt, fetchedAt };
      this.logger.log(`FX rates refreshed (${Object.keys(snapshot.rates).length} currencies)`);
      return true;
    } catch (error) {
      this.logger.warn(`FX refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return false;
    } finally {
      this.refreshing = false;
    }
  }

  private async loadFromStore() {
    try {
      const doc = await this.store.findOne({ base: BASE_CURRENCY }).lean().exec();
      if (doc?.rates && doc.rates[BASE_CURRENCY] === 1) {
        this.current = {
          rates: doc.rates,
          providerUpdatedAt: doc.providerUpdatedAt,
          fetchedAt: doc.fetchedAt,
        };
      }
    } catch {
      this.logger.warn('Could not load stored FX rates');
    }
  }
}
