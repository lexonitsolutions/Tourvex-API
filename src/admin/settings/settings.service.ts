import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { appError } from '../../common/app-error';
import {
  type CommerceSettingsDto,
  type SettingGroup,
  isSettingGroup,
  validateSettings,
} from './settings.dto';
import { SiteSetting } from './settings.schema';

export type CommerceSettings = Pick<
  CommerceSettingsDto,
  'taxPercent' | 'holdMinutes' | 'fxMarkupPercent' | 'bookingCutoffHours'
>;
export type SettingValues = Record<string, unknown>;

export interface SettingsView {
  group: SettingGroup;
  values: SettingValues;
  /** True while nothing is stored and the defaults (env for commerce) apply. */
  isDefault: boolean;
  updatedAt: Date | null;
  updatedBy: { id: string; email: string | null } | null;
}

export interface PublicSettings {
  siteName: string;
  supportEmail: string;
  supportPhone: string;
  socials: Record<string, string>;
}

interface CacheEntry {
  values: SettingValues;
  expiresAt: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** Stored values win over defaults, recursively for objects; arrays are taken as stored. */
export function mergeDefaults(defaults: SettingValues, stored: SettingValues): SettingValues {
  const result: SettingValues = { ...defaults };
  for (const [key, value] of Object.entries(stored)) {
    const base = result[key];
    result[key] = isPlainObject(base) && isPlainObject(value) ? mergeDefaults(base, value) : value;
  }
  return result;
}

/**
 * Site settings with a 60 s in-memory cache. Env values (CHECKOUT_TAX_PERCENT,
 * CHECKOUT_HOLD_MINUTES, FX_MARKUP_PERCENT) are the defaults; a stored value overrides them, so
 * operations can change them without a redeploy. Other instances converge within the TTL.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  static readonly TTL_MS = 60_000;
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<SettingGroup, CacheEntry>();
  private readonly refreshing = new Set<SettingGroup>();

  constructor(
    @InjectModel(SiteSetting.name) private readonly store: Model<SiteSetting>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.get('commerce');
  }

  defaults(group: SettingGroup): SettingValues {
    switch (group) {
      case 'general':
        return {
          siteName: 'Tourvex',
          supportEmail: '',
          supportPhone: '',
          address: '',
          legalName: '',
          taxNumber: '',
          socials: { facebook: '', instagram: '', x: '', youtube: '', linkedin: '', tiktok: '', whatsapp: '' },
        };
      case 'commerce':
        return {
          taxPercent: this.config.get<number>('CHECKOUT_TAX_PERCENT', 5),
          holdMinutes: this.config.get<number>('CHECKOUT_HOLD_MINUTES', 10),
          fxMarkupPercent: this.config.get<number>('FX_MARKUP_PERCENT', 0),
          bookingCutoffHours: 0,
        };
      case 'notifications':
        return {
          senderName: 'Tourvex',
          templates: {
            bookingConfirmation: {
              subject: 'Your booking {{bookingRef}} is confirmed',
              body: 'Hello {{customerName}},\n\nYour booking {{bookingRef}} for {{serviceName}} on {{travelDate}} is confirmed. Total: {{totalAmount}}.\n\nNeed help? {{supportEmail}}\n{{siteName}}',
            },
            voucher: {
              subject: 'Your voucher for {{serviceName}}',
              body: 'Hello {{customerName}},\n\nYour voucher for booking {{bookingRef}} is ready: {{voucherUrl}}\n\n{{siteName}}',
            },
            cancellation: {
              subject: 'Your booking {{bookingRef}} was cancelled',
              body: 'Hello {{customerName}},\n\nBooking {{bookingRef}} for {{serviceName}} was cancelled. {{cancellationReason}}\n\nQuestions? {{supportEmail}}\n{{siteName}}',
            },
          },
        };
      case 'homepage':
        return { sections: [] };
      case 'support':
        return { firstResponseHours: 4, resolutionHours: 48 };
    }
  }

  /** Effective values for a group (stored over defaults), cached for 60 s. */
  async get(group: SettingGroup): Promise<SettingValues> {
    const cached = this.cache.get(group);
    if (cached && cached.expiresAt > Date.now()) return cached.values;
    try {
      const doc = await this.store.findOne({ group }).lean<SiteSetting>().exec();
      const values = mergeDefaults(this.defaults(group), doc?.values ?? {});
      this.cache.set(group, { values, expiresAt: Date.now() + SettingsService.TTL_MS });
      return values;
    } catch (error) {
      this.logger.error(`Could not read ${group} settings: ${(error as Error).message}`);
      // Never fail a customer request because settings are unreadable: serve stale or defaults.
      return cached?.values ?? this.defaults(group);
    }
  }

  async getCommerce(): Promise<CommerceSettings> {
    return (await this.get('commerce')) as unknown as CommerceSettings;
  }

  /**
   * Synchronous view of the commerce settings for code that cannot await (response interceptors).
   * Returns the last known value (env defaults before the first load) and refreshes in the
   * background once the cache is older than the TTL.
   */
  peekCommerce(): CommerceSettings {
    const cached = this.cache.get('commerce');
    if ((!cached || cached.expiresAt <= Date.now()) && !this.refreshing.has('commerce')) {
      this.refreshing.add('commerce');
      void this.get('commerce').finally(() => this.refreshing.delete('commerce'));
    }
    return (cached?.values ?? this.defaults('commerce')) as unknown as CommerceSettings;
  }

  async view(rawGroup: string): Promise<SettingsView> {
    const group = this.parseGroup(rawGroup);
    const doc = await this.store.findOne({ group }).lean<SiteSetting>().exec();
    return this.toView(group, doc);
  }

  /** Validates and replaces the whole group. Returns the new view and the previous values. */
  async update(
    rawGroup: string,
    body: unknown,
    actor: { id: string; email: string },
  ): Promise<{ view: SettingsView; before: SettingValues }> {
    const group = this.parseGroup(rawGroup);
    const values = validateSettings(group, body);
    const previous = await this.store.findOne({ group }).lean<SiteSetting>().exec();
    const doc = await this.store
      .findOneAndUpdate(
        { group },
        {
          $set: {
            values,
            updatedBy: new Types.ObjectId(actor.id),
            updatedByEmail: actor.email,
          },
          $setOnInsert: { group },
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .lean<SiteSetting>()
      .exec();
    this.cache.delete(group);
    return {
      view: this.toView(group, doc),
      before: mergeDefaults(this.defaults(group), previous?.values ?? {}),
    };
  }

  /** `GET /settings/public`: only fields that are safe to show anonymously. */
  async getPublic(): Promise<PublicSettings> {
    const general = await this.get('general');
    const socials = (general.socials ?? {}) as Record<string, string>;
    return {
      siteName: general.siteName as string,
      supportEmail: general.supportEmail as string,
      supportPhone: (general.supportPhone as string) ?? '',
      socials: Object.fromEntries(Object.entries(socials).filter(([, url]) => Boolean(url))),
    };
  }

  private parseGroup(group: string): SettingGroup {
    if (!isSettingGroup(group)) throw appError(404, 'SETTINGS_GROUP_NOT_FOUND', `Unknown settings group "${group}"`);
    return group;
  }

  private toView(group: SettingGroup, doc: SiteSetting | null): SettingsView {
    return {
      group,
      values: mergeDefaults(this.defaults(group), doc?.values ?? {}),
      isDefault: !doc,
      updatedAt: doc?.updatedAt ?? null,
      updatedBy: doc?.updatedBy
        ? { id: doc.updatedBy.toString(), email: doc.updatedByEmail ?? null }
        : null,
    };
  }
}
