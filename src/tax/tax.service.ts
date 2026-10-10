import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SettingsService } from '../admin/settings/settings.service';
import { Cruise } from '../cruises/schemas/cruise.schema';
import { Event } from '../events/schemas/event.schema';
import { Holiday } from '../holidays/schemas/holiday.schema';
import { resolveCountryCode } from './countries';
import { SellerRegistration } from './schemas/seller-registration.schema';
import { TaxRegime } from './schemas/tax-regime.schema';
import { TaxSetting } from './schemas/tax-setting.schema';
import {
  type DetermineTaxInput,
  type RegimeRule,
  type SellerRule,
  type TaxDetermination,
  type TaxOverride,
  determineTax,
} from './tax.rules';

/** Activities carry no country in the catalog: they are delivered in the UAE unless a country can be derived. */
export const DEFAULT_SERVICE_COUNTRY = 'AE';

export interface TaxSettingsValues {
  defaultCountry: string;
  defaultRateFallbackPercent: number;
}

export type SellerFull = SellerRule & {
  legalName: string;
  registrationNumber: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  bankDetails: string;
  numberingScope: string;
};

export interface TaxData {
  regimes: RegimeRule[];
  sellers: SellerFull[];
  settings: TaxSettingsValues;
}

const CACHE_MS = 30_000;
const COUNTRY_CACHE_MS = 5 * 60_000;

export const toRegimeRule = (doc: TaxRegime): RegimeRule => ({
  id: doc._id.toString(),
  country: doc.country,
  countryName: doc.countryName,
  taxName: doc.taxName,
  invoiceTitle: doc.invoiceTitle,
  registrationLabel: doc.registrationLabel,
  model: doc.model,
  rates: (doc.rates ?? []).map((rate) => ({ code: rate.code, label: rate.label, percent: rate.percent, isDefault: Boolean(rate.isDefault) })),
  ...(doc.serviceCode && { serviceCode: { label: doc.serviceCode.label, value: doc.serviceCode.value, description: doc.serviceCode.description } }),
  pricesIncludeTax: Boolean(doc.pricesIncludeTax),
  numbering: {
    prefix: doc.numbering?.prefix ?? 'INV',
    creditPrefix: doc.numbering?.creditPrefix ?? 'CN',
    includeCountry: Boolean(doc.numbering?.includeCountry),
    yearDigits: doc.numbering?.yearDigits ?? 4,
    sequenceDigits: doc.numbering?.sequenceDigits ?? 6,
    maxLength: doc.numbering?.maxLength ?? null,
  },
  invoiceNotes: doc.invoiceNotes ?? '',
  qr: doc.qr ?? 'none',
  active: Boolean(doc.active),
});

export const toSellerFull = (doc: SellerRegistration): SellerFull => ({
  id: doc._id.toString(),
  country: doc.country,
  state: doc.state ?? '',
  stateCode: doc.stateCode ?? '',
  isDefault: Boolean(doc.isDefault),
  active: Boolean(doc.active),
  legalName: doc.legalName,
  registrationNumber: doc.registrationNumber ?? '',
  address: doc.address ?? '',
  email: doc.email ?? '',
  phone: doc.phone ?? '',
  website: doc.website ?? '',
  bankDetails: doc.bankDetails ?? '',
  numberingScope: doc.numberingScope,
});

/**
 * Read side of the tax tables: loads regimes, sellers and settings (30 s cache, dropped on every admin edit) and
 * answers "which tax applies to this supply?". Used by checkout, the catalog quote, invoices and the enquiry confirm.
 */
@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);
  private cached?: { at: number; data: TaxData };
  private readonly countries = new Map<string, { at: number; country: string }>();

  constructor(
    @InjectModel(TaxRegime.name) private readonly regimes: Model<TaxRegime>,
    @InjectModel(SellerRegistration.name) private readonly sellers: Model<SellerRegistration>,
    @InjectModel(TaxSetting.name) private readonly settingsDocs: Model<TaxSetting>,
    @InjectModel(Holiday.name) private readonly holidays: Model<Holiday>,
    @InjectModel(Cruise.name) private readonly cruises: Model<Cruise>,
    @InjectModel(Event.name) private readonly events: Model<Event>,
    private readonly commerce: SettingsService,
  ) {}

  invalidate(): void {
    this.cached = undefined;
  }

  async data(): Promise<TaxData> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.data;
    try {
      const [regimes, sellers, settings] = await Promise.all([
        this.regimes.find().sort({ country: 1 }).lean().exec(),
        this.sellers.find().sort({ createdAt: 1 }).lean().exec(),
        this.settingsDocs.findOne({ key: 'tax' }).lean().exec(),
      ]);
      const fallback = settings?.defaultRateFallbackPercent ?? (await this.commerce.getCommerce()).taxPercent;
      const data: TaxData = {
        regimes: regimes.map(toRegimeRule),
        sellers: sellers.map(toSellerFull),
        settings: { defaultCountry: settings?.defaultCountry ?? DEFAULT_SERVICE_COUNTRY, defaultRateFallbackPercent: fallback },
      };
      this.cached = { at: Date.now(), data };
      return data;
    } catch (error) {
      this.logger.error(`Could not read the tax tables: ${(error as Error).message}`);
      if (this.cached) return this.cached.data;
      throw error;
    }
  }

  async settings(): Promise<TaxSettingsValues> {
    return (await this.data()).settings;
  }

  /** Which tax applies to a supply delivered in `serviceCountry`. */
  async determine(
    input: Pick<DetermineTaxInput, 'serviceCountry' | 'customerCountry' | 'customerState' | 'customerStateCode'> & { override?: TaxOverride },
  ): Promise<TaxDetermination> {
    const data = await this.data();
    return determineTax({
      ...input,
      regimes: data.regimes,
      sellers: data.sellers,
      defaultCountry: data.settings.defaultCountry,
      fallbackPercent: data.settings.defaultRateFallbackPercent,
    });
  }

  /** Country where a product is delivered: holiday/event `country`, cruise `departureCountry`, activities default to AE. */
  async countryForProduct(type: string, ref: string): Promise<string> {
    if (type === 'activity' || !ref) return DEFAULT_SERVICE_COUNTRY;
    const key = `${type}:${ref}`;
    const hit = this.countries.get(key);
    if (hit && Date.now() - hit.at < COUNTRY_CACHE_MS) return hit.country;
    let name: string | undefined;
    try {
      if (type === 'holiday') name = (await this.holidays.findOne({ slug: ref }).select('country').lean().exec())?.country;
      else if (type === 'cruise') name = (await this.cruises.findOne({ slug: ref }).select('departureCountry').lean().exec())?.departureCountry;
      else if (type === 'event') name = (await this.events.findOne({ slug: ref }).select('country').lean().exec())?.country;
    } catch (error) {
      this.logger.warn(`Could not derive the country of ${type} ${ref}: ${(error as Error).message}`);
    }
    const country = resolveCountryCode(name) ?? DEFAULT_SERVICE_COUNTRY;
    this.countries.set(key, { at: Date.now(), country });
    return country;
  }

  async determineForProduct(type: string, ref: string, override?: TaxOverride): Promise<TaxDetermination> {
    return this.determine({ serviceCountry: await this.countryForProduct(type, ref), override });
  }

  async regimeById(id: string | null | undefined): Promise<RegimeRule | null> {
    if (!id) return null;
    return (await this.data()).regimes.find((regime) => regime.id === id) ?? null;
  }

  async sellerById(id: string | null | undefined): Promise<SellerFull | null> {
    if (!id) return null;
    return (await this.data()).sellers.find((seller) => seller.id === id) ?? null;
  }
}
