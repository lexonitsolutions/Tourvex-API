import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mongoose from 'mongoose';
import {
  normalizeDepartureDates,
  resolveDurationDays,
  slugify,
  validateItinerary,
} from '../src/cruises/cruises.utils';
import { CreateCruiseDto } from '../src/cruises/dto/create-cruise.dto';
import { CruiseBanner, CruiseBannerSchema } from '../src/cruises/schemas/cruise-banner.schema';
import { Cruise, CruiseSchema } from '../src/cruises/schemas/cruise.schema';
import { SAMPLE_BANNERS, SAMPLE_CRUISES } from './data/cruises-sample';

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

/** Same rules as the admin API: DTO validation, future-only departures, consistent itinerary. */
async function toValidCruise(raw: unknown, defaultSample: boolean) {
  const dto = plainToInstance(CreateCruiseDto, raw);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const messages = errors.flatMap((e) =>
      Object.values(e.constraints ?? { [e.property]: 'invalid nested value' }),
    );
    return { error: messages.join('; ') };
  }
  const slug = dto.slug ?? slugify(dto.title);
  if (!slug) return { error: 'could not derive a slug from the title' };
  const durationDays = resolveDurationDays(dto.durationNights, dto.durationDays);
  const itineraryError = validateItinerary(dto.itinerary, durationDays);
  if (itineraryError) return { error: itineraryError };
  return {
    value: {
      ...dto,
      slug,
      durationDays,
      // Replaced wholesale on every run, so a re-seed refreshes stale dates.
      departures: normalizeDepartureDates(dto.departures),
      isSample: dto.isSample ?? defaultSample,
    },
  };
}

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const file = parseFileArg(process.argv.slice(2));

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const cruises = mongoose.model<Cruise>(Cruise.name, CruiseSchema);
  const banners = mongoose.model<CruiseBanner>(CruiseBanner.name, CruiseBannerSchema);
  await Promise.all([cruises.init(), banners.init()]);

  const cruiseCounts = emptyCounts();
  let source: unknown[];
  if (file) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('The JSON file must contain an array of cruises');
    source = parsed;
  } else {
    source = SAMPLE_CRUISES;
  }

  for (const [index, raw] of source.entries()) {
    const title = (raw as { title?: string } | null)?.title;
    const label = `#${index + 1}${title ? ` (${title})` : ''}`;
    const result = await toValidCruise(raw, !file);
    if (!result.value) {
      cruiseCounts.failed += 1;
      console.error(`Cruise ${label} skipped: ${result.error}`);
      continue;
    }
    const { slug, ...data } = result.value;
    const outcome = await cruises.updateOne(
      { slug },
      { $set: data },
      { upsert: true, setDefaultsOnInsert: true },
    );
    if (outcome.upsertedCount) cruiseCounts.created += 1;
    else cruiseCounts.updated += 1;
  }

  const summary: Record<string, Counts> = { cruises: cruiseCounts };

  if (!file) {
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
    summary.banners = bannerCounts;
  }

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  if (cruiseCounts.failed > 0) process.exitCode = 1;
}

run().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
