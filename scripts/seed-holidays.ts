import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mongoose from 'mongoose';
import { CreateHolidayDto } from '../src/holidays/dto/create-holiday.dto';
import { slugify } from '../src/holidays/holidays.utils';
import { HolidayBanner, HolidayBannerSchema } from '../src/holidays/schemas/holiday-banner.schema';
import {
  HolidayCollection,
  HolidayCollectionSchema,
} from '../src/holidays/schemas/holiday-collection.schema';
import { Holiday, HolidaySchema } from '../src/holidays/schemas/holiday.schema';
import { SAMPLE_BANNERS, SAMPLE_COLLECTIONS, SAMPLE_PACKAGES } from './data/holidays-sample';

interface Counts {
  created: number;
  updated: number;
  failed: number;
}

const emptyCounts = (): Counts => ({ created: 0, updated: 0, failed: 0 });

function parseFileArg(argv: string[]): string | undefined {
  const index = argv.indexOf('--file');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('--file requires a path to a JSON file');
  return resolve(process.cwd(), value);
}

async function toValidPackage(raw: unknown, defaultSample: boolean) {
  const dto = plainToInstance(CreateHolidayDto, raw);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? { [e.property]: 'invalid nested value' }));
    return { error: messages.join('; ') };
  }
  const slug = dto.slug ?? slugify(dto.title);
  if (!slug) return { error: 'could not derive a slug from the title' };
  return {
    value: {
      ...dto,
      slug,
      durationDays: dto.durationDays ?? dto.durationNights + 1,
      isSample: dto.isSample ?? defaultSample,
    },
  };
}

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const file = parseFileArg(process.argv.slice(2));

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const holidays = mongoose.model<Holiday>(Holiday.name, HolidaySchema);
  const collections = mongoose.model<HolidayCollection>(HolidayCollection.name, HolidayCollectionSchema);
  const banners = mongoose.model<HolidayBanner>(HolidayBanner.name, HolidayBannerSchema);
  await Promise.all([holidays.init(), collections.init(), banners.init()]);

  const packageCounts = emptyCounts();
  let source: unknown[];
  if (file) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('The JSON file must contain an array of packages');
    source = parsed;
  } else {
    source = SAMPLE_PACKAGES;
  }

  for (const [index, raw] of source.entries()) {
    const label = `#${index + 1}${(raw as { title?: string })?.title ? ` (${(raw as { title: string }).title})` : ''}`;
    const result = await toValidPackage(raw, !file);
    if (!result.value) {
      packageCounts.failed += 1;
      console.error(`Package ${label} skipped: ${result.error}`);
      continue;
    }
    const { slug, ...data } = result.value;
    const outcome = await holidays.updateOne(
      { slug },
      { $set: data },
      { upsert: true, setDefaultsOnInsert: true },
    );
    if (outcome.upsertedCount) packageCounts.created += 1;
    else packageCounts.updated += 1;
  }

  const summary: Record<string, Counts> = { packages: packageCounts };

  if (!file) {
    const collectionCounts = emptyCounts();
    for (const collection of SAMPLE_COLLECTIONS) {
      const outcome = await collections.updateOne(
        { slug: collection.slug },
        { $set: collection },
        { upsert: true, setDefaultsOnInsert: true },
      );
      if (outcome.upsertedCount) collectionCounts.created += 1;
      else collectionCounts.updated += 1;
    }
    const bannerCounts = emptyCounts();
    for (const banner of SAMPLE_BANNERS) {
      const outcome = await banners.updateOne(
        { title: banner.title },
        { $set: banner },
        { upsert: true, setDefaultsOnInsert: true },
      );
      if (outcome.upsertedCount) bannerCounts.created += 1;
      else bannerCounts.updated += 1;
    }
    summary.collections = collectionCounts;
    summary.banners = bannerCounts;
  }

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  if (packageCounts.failed > 0) process.exitCode = 1;
}

run().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
