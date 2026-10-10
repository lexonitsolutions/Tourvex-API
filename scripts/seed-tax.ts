import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { SellerRegistration, SellerRegistrationSchema } from '../src/tax/schemas/seller-registration.schema';
import { TaxRegime, TaxRegimeSchema } from '../src/tax/schemas/tax-regime.schema';
import { TaxSetting, TaxSettingSchema } from '../src/tax/schemas/tax-setting.schema';
import { DEFAULT_REGIMES } from '../src/tax/tax.defaults';

/**
 * Seeds the tax tables (`npm run seed:tax`). Idempotent and non-destructive: a regime that already exists for a country
 * (active or not), a seller registration, or the settings document is never touched, so admin edits survive a re-run.
 * The default seller registration is built from the existing general settings (legal name, tax number, address).
 */
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' && value.trim() ? value : fallback);

async function run() {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');

  const regimes = mongoose.model<TaxRegime>(TaxRegime.name, TaxRegimeSchema);
  const sellers = mongoose.model<SellerRegistration>(SellerRegistration.name, SellerRegistrationSchema);
  const settings = mongoose.model<TaxSetting>(TaxSetting.name, TaxSettingSchema);
  await Promise.all([regimes.init(), sellers.init(), settings.init()]);

  const counts = { regimesCreated: 0, regimesKept: 0, sellerCreated: false, settingsCreated: false };

  for (const regime of DEFAULT_REGIMES) {
    const result = await regimes
      .updateOne({ country: regime.country }, { $setOnInsert: regime }, { upsert: true, setDefaultsOnInsert: true })
      .exec();
    if (result.upsertedCount) counts.regimesCreated += 1;
    else counts.regimesKept += 1;
  }

  const store = mongoose.connection.collection<{ group: string; values?: Record<string, unknown> }>('site_settings');
  const general = (await store.findOne({ group: 'general' }))?.values ?? {};
  const commerce = (await store.findOne({ group: 'commerce' }))?.values ?? {};

  if ((await sellers.estimatedDocumentCount().exec()) === 0) {
    const id = new mongoose.Types.ObjectId();
    await sellers.create({
      _id: id,
      country: 'AE',
      legalName: text(general.legalName, text(general.siteName, 'Karnish Tourism')),
      registrationNumber: text(general.taxNumber),
      address: text(general.address),
      state: '',
      stateCode: '',
      email: text(general.supportEmail),
      phone: text(general.supportPhone),
      website: '',
      bankDetails: '',
      isDefault: true,
      active: true,
      // The counters that existed before regimes keep numbering this registration's invoices (no repeats, no gaps).
      numberingScope: 'legacy',
    });
    counts.sellerCreated = true;
  }

  const fallback = typeof commerce.taxPercent === 'number' ? commerce.taxPercent : Number(process.env.CHECKOUT_TAX_PERCENT ?? 5);
  const upserted = await settings
    .updateOne(
      { key: 'tax' },
      { $setOnInsert: { key: 'tax', defaultCountry: 'AE', defaultRateFallbackPercent: Number.isFinite(fallback) ? fallback : 5 } },
      { upsert: true },
    )
    .exec();
  counts.settingsCreated = Boolean(upserted.upsertedCount);

  console.log(
    `Tax seed done: regimes created ${counts.regimesCreated}, kept ${counts.regimesKept}; ` +
      `default seller ${counts.sellerCreated ? 'created' : 'kept'}; settings ${counts.settingsCreated ? 'created' : 'kept'}.`,
  );
  await mongoose.disconnect();
}

run().catch(async (error: unknown) => {
  console.error('Tax seed failed:', error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
