import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { appError } from '../common/app-error';
import { Booking } from '../bookings/schemas/booking.schema';
import { Invoice } from '../crm/billing/schemas/invoice.schema';
import { numberingFits } from '../crm/billing/invoice-rules';
import { COUNTRIES } from './countries';
import { SellerRegistration } from './schemas/seller-registration.schema';
import { TaxRegime } from './schemas/tax-regime.schema';
import { TaxSetting } from './schemas/tax-setting.schema';
import type {
  CreateRegimeDto,
  CreateSellerDto,
  TaxPreviewDto,
  UpdateRegimeDto,
  UpdateSellerDto,
  UpdateTaxSettingsDto,
} from './tax.dto';
import { TaxRuleError, exclusiveBreakdown, fromMinor, inclusiveBreakdown, toMinor } from './tax.rules';
import { TaxService } from './tax.service';

const duplicate = (error: unknown) => (error as { code?: number }).code === 11000;
const idOf = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw appError(404, 'NOT_FOUND', 'Not found');
  return new Types.ObjectId(id);
};

/** Admin CRUD of the tax tables (regimes, seller registrations, settings) plus the calculator preview. */
@Injectable()
export class TaxAdminService {
  constructor(
    @InjectModel(TaxRegime.name) private readonly regimes: Model<TaxRegime>,
    @InjectModel(SellerRegistration.name) private readonly sellers: Model<SellerRegistration>,
    @InjectModel(TaxSetting.name) private readonly settingsDocs: Model<TaxSetting>,
    @InjectModel(Invoice.name) private readonly invoices: Model<Invoice>,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    private readonly tax: TaxService,
  ) {}

  countries() {
    return COUNTRIES.map((country) => ({ ...country }));
  }

  // ---------------------------------------------------------------- regimes

  regimeView(doc: TaxRegime) {
    return {
      id: doc._id.toString(),
      country: doc.country,
      countryName: doc.countryName,
      taxName: doc.taxName,
      invoiceTitle: doc.invoiceTitle,
      registrationLabel: doc.registrationLabel,
      model: doc.model,
      rates: doc.rates.map((rate) => ({ code: rate.code, label: rate.label, percent: rate.percent, isDefault: rate.isDefault })),
      serviceCode: doc.serviceCode
        ? { label: doc.serviceCode.label, value: doc.serviceCode.value, description: doc.serviceCode.description ?? '' }
        : null,
      pricesIncludeTax: doc.pricesIncludeTax,
      numbering: {
        prefix: doc.numbering.prefix,
        creditPrefix: doc.numbering.creditPrefix,
        includeCountry: doc.numbering.includeCountry,
        yearDigits: doc.numbering.yearDigits,
        sequenceDigits: doc.numbering.sequenceDigits,
        maxLength: doc.numbering.maxLength ?? null,
      },
      invoiceNotes: doc.invoiceNotes ?? '',
      qr: doc.qr,
      active: doc.active,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async listRegimes() {
    const rows = await this.regimes.find().sort({ countryName: 1 }).lean().exec();
    return { items: rows.map((row) => this.regimeView(row)) };
  }

  private checkRegime(value: { country: string; rates: { code: string; isDefault: boolean }[]; numbering: Parameters<typeof numberingFits>[0] }) {
    const defaults = value.rates.filter((rate) => rate.isDefault).length;
    if (defaults !== 1) throw appError(400, 'INVALID_RATES', 'Exactly one rate must be the default');
    if (new Set(value.rates.map((rate) => rate.code)).size !== value.rates.length) {
      throw appError(400, 'INVALID_RATES', 'Rate codes must be unique');
    }
    if (!numberingFits(value.numbering, value.country)) {
      throw appError(400, 'NUMBERING_TOO_LONG', 'These numbering settings can produce numbers longer than the maximum length');
    }
  }

  async createRegime(dto: CreateRegimeDto) {
    const countryName = dto.countryName || COUNTRIES.find((c) => c.code === dto.country)?.name;
    if (!countryName) throw appError(400, 'COUNTRY_NAME_REQUIRED', 'countryName is required for a country that is not in the countries list');
    const values = {
      ...dto,
      countryName,
      serviceCode: dto.serviceCode ?? undefined,
      numbering: { ...dto.numbering, maxLength: dto.numbering.maxLength ?? null },
    };
    this.checkRegime(values);
    try {
      const created = await this.regimes.create(values);
      this.tax.invalidate();
      return this.regimeView(created.toObject());
    } catch (error) {
      if (duplicate(error)) throw appError(409, 'REGIME_COUNTRY_EXISTS', 'An active regime already exists for this country');
      throw error;
    }
  }

  async updateRegime(id: string, dto: UpdateRegimeDto) {
    const existing = await this.regimes.findById(idOf(id)).lean().exec();
    if (!existing) throw appError(404, 'REGIME_NOT_FOUND', 'Tax regime not found');
    const { serviceCode, numbering, ...rest } = dto;
    if ('country' in dto) throw appError(400, 'COUNTRY_IMMUTABLE', 'The country of a regime cannot be changed');
    const merged = {
      country: existing.country,
      rates: rest.rates ?? existing.rates,
      numbering: numbering
        ? { ...numbering, maxLength: numbering.maxLength ?? null }
        : { ...existing.numbering, maxLength: existing.numbering.maxLength ?? null },
    };
    this.checkRegime(merged);
    const update: Record<string, unknown> = { ...rest, numbering: merged.numbering };
    const unset: Record<string, 1> = {};
    if (serviceCode === null) unset.serviceCode = 1;
    else if (serviceCode) update.serviceCode = serviceCode;
    try {
      const updated = await this.regimes
        .findByIdAndUpdate(existing._id, { $set: update, ...(Object.keys(unset).length && { $unset: unset }) }, { returnDocument: 'after', runValidators: true })
        .lean()
        .exec();
      this.tax.invalidate();
      return this.regimeView(updated!);
    } catch (error) {
      if (duplicate(error)) throw appError(409, 'REGIME_COUNTRY_EXISTS', 'An active regime already exists for this country');
      throw error;
    }
  }

  async deleteRegime(id: string) {
    const _id = idOf(id);
    const existing = await this.regimes.findById(_id).lean().exec();
    if (!existing) throw appError(404, 'REGIME_NOT_FOUND', 'Tax regime not found');
    const [invoices, bookings] = await Promise.all([
      this.invoices.exists({ 'taxInfo.regimeId': id }).exec(),
      this.bookings.exists({ taxRegimeId: id }).exec(),
    ]);
    if (invoices || bookings) {
      throw appError(409, 'REGIME_IN_USE', 'Invoices or bookings use this regime; deactivate it instead');
    }
    await this.regimes.deleteOne({ _id }).exec();
    this.tax.invalidate();
    return { deleted: true };
  }

  // ---------------------------------------------------------------- sellers

  sellerView(doc: SellerRegistration) {
    return {
      id: doc._id.toString(),
      country: doc.country,
      legalName: doc.legalName,
      registrationNumber: doc.registrationNumber ?? '',
      address: doc.address ?? '',
      state: doc.state ?? '',
      stateCode: doc.stateCode ?? '',
      email: doc.email ?? '',
      phone: doc.phone ?? '',
      website: doc.website ?? '',
      bankDetails: doc.bankDetails ?? '',
      isDefault: doc.isDefault,
      active: doc.active,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async listSellers() {
    const rows = await this.sellers.find().sort({ createdAt: 1 }).lean().exec();
    return { items: rows.map((row) => this.sellerView(row)) };
  }

  private async assertCountryFree(country: string, exceptId?: Types.ObjectId) {
    const clash = await this.sellers
      .exists({ country, active: true, ...(exceptId && { _id: { $ne: exceptId } }) })
      .exec();
    if (clash) throw appError(409, 'SELLER_COUNTRY_EXISTS', 'An active registration already exists for this country');
  }

  async createSeller(dto: CreateSellerDto) {
    const _id = new Types.ObjectId();
    const count = await this.sellers.estimatedDocumentCount().exec();
    const active = dto.active ?? true;
    const isDefault = count === 0 ? true : (dto.isDefault ?? false);
    if (isDefault && !active) throw appError(400, 'DEFAULT_REQUIRED', 'The default registration must be active');
    if (active) await this.assertCountryFree(dto.country);
    if (isDefault && count > 0) await this.sellers.updateMany({ isDefault: true }, { $set: { isDefault: false } }).exec();
    try {
      const created = await this.sellers.create({
        ...dto,
        _id,
        active,
        isDefault,
        numberingScope: count === 0 ? 'legacy' : _id.toString(),
      });
      this.tax.invalidate();
      return this.sellerView(created.toObject());
    } catch (error) {
      if (duplicate(error)) throw appError(409, 'SELLER_COUNTRY_EXISTS', 'An active registration already exists for this country');
      throw error;
    }
  }

  async updateSeller(id: string, dto: UpdateSellerDto) {
    const _id = idOf(id);
    const existing = await this.sellers.findById(_id).lean().exec();
    if (!existing) throw appError(404, 'SELLER_NOT_FOUND', 'Seller registration not found');
    const isDefault = dto.isDefault ?? existing.isDefault;
    const active = dto.active ?? existing.active;
    if (existing.isDefault && !isDefault) throw appError(400, 'DEFAULT_REQUIRED', 'Make another registration the default instead');
    if (isDefault && !active) throw appError(400, 'DEFAULT_REQUIRED', 'The default registration must be active');
    if (active && (dto.country || dto.active)) await this.assertCountryFree(dto.country ?? existing.country, _id);
    if (isDefault && !existing.isDefault) {
      await this.sellers.updateMany({ isDefault: true, _id: { $ne: _id } }, { $set: { isDefault: false } }).exec();
    }
    try {
      const updated = await this.sellers
        .findByIdAndUpdate(_id, { $set: { ...dto, isDefault } }, { returnDocument: 'after', runValidators: true })
        .lean()
        .exec();
      this.tax.invalidate();
      return this.sellerView(updated!);
    } catch (error) {
      if (duplicate(error)) throw appError(409, 'SELLER_COUNTRY_EXISTS', 'An active registration already exists for this country');
      throw error;
    }
  }

  async deleteSeller(id: string) {
    const _id = idOf(id);
    const existing = await this.sellers.findById(_id).lean().exec();
    if (!existing) throw appError(404, 'SELLER_NOT_FOUND', 'Seller registration not found');
    if (existing.isDefault) throw appError(409, 'SELLER_IS_DEFAULT', 'The default registration cannot be deleted; make another one the default first');
    const issued = await this.invoices.exists({ 'seller.sellerId': id }).exec();
    if (issued || existing.numberingScope === 'legacy') {
      throw appError(409, 'SELLER_IN_USE', 'Invoices were issued by this registration; deactivate it instead');
    }
    await this.sellers.deleteOne({ _id }).exec();
    this.tax.invalidate();
    return { deleted: true };
  }

  // ---------------------------------------------------------------- settings

  async getSettings() {
    const settings = await this.tax.settings();
    return { defaultCountry: settings.defaultCountry, defaultRateFallbackPercent: settings.defaultRateFallbackPercent };
  }

  async updateSettings(dto: UpdateTaxSettingsDto) {
    const current = await this.tax.settings();
    await this.settingsDocs
      .updateOne(
        { key: 'tax' },
        {
          $set: {
            defaultCountry: dto.defaultCountry ?? current.defaultCountry,
            defaultRateFallbackPercent: dto.defaultRateFallbackPercent ?? current.defaultRateFallbackPercent,
          },
          $setOnInsert: { key: 'tax' },
        },
        { upsert: true, runValidators: true },
      )
      .exec();
    this.tax.invalidate();
    return this.getSettings();
  }

  // ---------------------------------------------------------------- preview

  async preview(dto: TaxPreviewDto) {
    let determination;
    try {
      determination = await this.tax.determine({
        serviceCountry: dto.country,
        customerState: dto.state,
        customerStateCode: dto.stateCode,
        ...(dto.rateCode && { override: { rateCode: dto.rateCode } }),
      });
    } catch (error) {
      if (error instanceof TaxRuleError) throw appError(400, error.code, error.message);
      throw error;
    }
    const inclusive = dto.pricesIncludeTax ?? determination.pricesIncludeTax;
    const amount = toMinor(dto.amount);
    const breakdown = inclusive ? inclusiveBreakdown(amount, determination) : exclusiveBreakdown(amount, determination);
    const seller = determination.sellerId ? await this.sellers.findById(determination.sellerId).lean().exec() : null;
    return {
      determination,
      pricesIncludeTax: inclusive,
      net: fromMinor(breakdown.netMinor),
      components: breakdown.components.map((c) => ({ code: c.code, label: c.label, percent: c.percent, taxAmount: fromMinor(c.taxMinor) })),
      taxTotal: fromMinor(breakdown.taxMinor),
      total: fromMinor(breakdown.totalMinor),
      seller: seller
        ? {
            id: seller._id.toString(),
            legalName: seller.legalName,
            registrationNumber: seller.registrationNumber ?? '',
            registrationLabel: (await this.tax.regimeById(determination.regimeId))?.registrationLabel ?? '',
            country: seller.country,
          }
        : null,
    };
  }
}
