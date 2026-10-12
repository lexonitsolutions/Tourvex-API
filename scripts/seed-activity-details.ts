import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mongoose from 'mongoose';
import { validateOptions } from '../src/catalog/activity-booking.utils';
import { UpdateActivityDetailsDto } from '../src/catalog/dto/update-activity-details.dto';
import { Activity, ActivitySchema } from '../src/catalog/schemas/activity.schema';
import { PromoCode, PromoCodeSchema } from '../src/checkout/schemas/promo-code.schema';
import {
  SAMPLE_ACTIVITY_DETAILS,
  SAMPLE_PROMOS,
  type SampleActivityDetails,
} from './data/activity-details-sample';

interface Counts {
  updated: number;
  unchanged: number;
  missing: number;
  failed: number;
}

function parseFileArg(argv: string[]): string | undefined {
  const index = argv.indexOf('--file');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('--file requires a path to a JSON file');
  return resolve(process.cwd(), value);
}

/** The 15th of next month (YYYY-MM-DD, UTC): a sample blackout date that is always in the future. */
function sampleBlackoutDate(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15)).toISOString().slice(0, 10);
}

const round = (value: number) => Math.round(value);

/** Builds the details payload from a sample and the activity's own listed price. */
function buildFromSample(sample: SampleActivityDetails, activity: Activity) {
  const base = activity.salePrice?.amount ?? activity.price?.amount;
  if (!base) return null;
  const image = activity.imageUrl;
  return {
    ...(image && { gallery: [{ url: image, alt: activity.title.en }] }),
    operatingHours: sample.operatingHours,
    instantConfirmation: sample.instantConfirmation,
    mobileVoucher: sample.mobileVoucher,
    freeCancellationHours: sample.freeCancellationHours ?? null,
    languages: sample.languages,
    description: sample.description,
    highlights: sample.highlights,
    inclusions: sample.inclusions,
    exclusions: sample.exclusions,
    howToRedeem: sample.howToRedeem,
    importantInfo: sample.importantInfo,
    ...(sample.whatToBring && { whatToBring: sample.whatToBring }),
    ...(sample.cancellationPolicy && { cancellationPolicy: sample.cancellationPolicy }),
    ...(sample.itinerary && { itinerary: sample.itinerary }),
    ...(sample.faqs && { faqs: sample.faqs }),
    ...(sample.contentSections && { contentSections: sample.contentSections }),
    duration: sample.duration,
    location: { name: sample.locationName, address: sample.locationAddress },
    options: sample.options.map((option) => {
      const adult = round(base * option.priceFactor);
      return {
        id: option.id,
        name: option.name,
        transferType: option.transferType,
        ...(option.startTime && { startTime: option.startTime }),
        ...(option.durationLabel && { durationLabel: option.durationLabel }),
        adultPrice: { amount: adult, currency: 'AED' },
        childPrice:
          option.childRatio !== undefined
            ? { amount: round(adult * option.childRatio), currency: 'AED' }
            : null,
        ...(option.childAgeRange && { childAgeRange: option.childAgeRange }),
        minPax: option.minPax,
        maxPax: option.maxPax,
        pickupRequired: option.pickupRequired,
        refundable: option.refundable,
        freeCancellationHours: option.refundable ? (option.freeCancellationHours ?? null) : null,
        operatingWeekdays: option.operatingWeekdays,
        blackoutDates: option.withBlackout ? [sampleBlackoutDate()] : [],
        dailyCapacity: option.dailyCapacity ?? null,
        cutoffHours: option.cutoffHours ?? 0,
      };
    }),
    detailsAreSample: true,
  };
}

async function validated(raw: unknown) {
  const dto = plainToInstance(UpdateActivityDetailsDto, raw);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const messages = errors.flatMap((e) =>
      Object.values(e.constraints ?? { [e.property]: 'invalid nested value' }),
    );
    return { error: messages.join('; ') };
  }
  if (dto.options) {
    const problem = validateOptions(dto.options);
    if (problem) return { error: problem };
  }
  return { value: dto };
}

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const file = parseFileArg(process.argv.slice(2));

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const activities = mongoose.model<Activity>(Activity.name, ActivitySchema);
  const promos = mongoose.model<PromoCode>(PromoCode.name, PromoCodeSchema);
  await Promise.all([activities.init(), promos.init()]);

  const counts: Counts = { updated: 0, unchanged: 0, missing: 0, failed: 0 };
  let source: Array<{ slug: string; payload: unknown; label: string }>;

  if (file) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('The JSON file must contain an array of activity details');
    source = parsed.map((raw: { slug?: string } & Record<string, unknown>, index) => {
      const { slug, ...rest } = raw ?? {};
      return {
        slug: String(slug ?? ''),
        // Imported data is real unless the file says otherwise.
        payload: { detailsAreSample: false, ...rest },
        label: `#${index + 1} (${String(slug ?? 'no slug')})`,
      };
    });
  } else {
    source = [];
    for (const sample of SAMPLE_ACTIVITY_DETAILS) {
      const activity = await activities.findOne({ slug: sample.slug }).lean().exec();
      if (!activity) {
        counts.missing += 1;
        console.warn(`Activity ${sample.slug} not found (run npm run seed:activities first)`);
        continue;
      }
      const payload = buildFromSample(sample, activity);
      if (!payload) {
        counts.failed += 1;
        console.error(`Activity ${sample.slug} has no listed price; skipped`);
        continue;
      }
      source.push({ slug: sample.slug, payload, label: sample.slug });
    }
  }

  for (const { slug, payload, label } of source) {
    const result = await validated(payload);
    if (!result.value) {
      counts.failed += 1;
      console.error(`Activity ${label} skipped: ${result.error}`);
      continue;
    }
    if (!slug) {
      counts.failed += 1;
      console.error(`Activity ${label} skipped: slug is required`);
      continue;
    }
    // Only the whitelisted detail fields are set; replacing arrays keeps re-runs idempotent.
    const outcome = await activities.updateOne({ slug }, { $set: { ...result.value } });
    if (outcome.matchedCount === 0) {
      counts.missing += 1;
      console.warn(`Activity ${label} not found; nothing imported`);
    } else if (outcome.modifiedCount) counts.updated += 1;
    else counts.unchanged += 1;
  }

  const summary: Record<string, unknown> = { activities: counts };

  if (!file) {
    const promoCounts = { created: 0, updated: 0 };
    for (const promo of SAMPLE_PROMOS) {
      const outcome = await promos.updateOne(
        { code: promo.code },
        {
          $set: { ...promo, appliesTo: [], published: true, isSample: true },
          $setOnInsert: { usedCount: 0 },
        },
        { upsert: true },
      );
      if (outcome.upsertedCount) promoCounts.created += 1;
      else promoCounts.updated += 1;
    }
    summary.promoCodes = promoCounts;
  }

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  if (counts.failed > 0) process.exitCode = 1;
}

run().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
