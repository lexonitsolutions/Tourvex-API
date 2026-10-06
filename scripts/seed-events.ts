import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mongoose from 'mongoose';
import { CreateEventDto } from '../src/events/dto/create-event.dto';
import { normalizeSessions, slugify, validateSessions } from '../src/events/events.utils';
import { EventBanner, EventBannerSchema } from '../src/events/schemas/event-banner.schema';
import { Event, EventSchema } from '../src/events/schemas/event.schema';
import { SAMPLE_BANNERS, SAMPLE_EVENTS } from './data/events-sample';

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

/** Stable session ids (derived from slug + start time) so re-seeding keeps ids that enquiries may reference. */
function sessionId(slug: string, startsAt: Date): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(
    createHash('sha1').update(`${slug}|${startsAt.toISOString()}`).digest('hex').slice(0, 24),
  );
}

/** Same rules as the admin API: DTO validation, future-only sessions, consistent door times. */
async function toValidEvent(raw: unknown, defaultSample: boolean) {
  const dto = plainToInstance(CreateEventDto, raw);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const messages = errors.flatMap((e) =>
      Object.values(e.constraints ?? { [e.property]: 'invalid nested value' }),
    );
    return { error: messages.join('; ') };
  }
  const slug = dto.slug ?? slugify(dto.title);
  if (!slug) return { error: 'could not derive a slug from the title' };
  const sessionError = validateSessions(dto.sessions);
  if (sessionError) return { error: sessionError };
  return {
    value: {
      ...dto,
      slug,
      // Replaced wholesale on every run, so a re-seed refreshes stale dates.
      sessions: normalizeSessions(dto.sessions).map((s) => ({
        _id: sessionId(slug, s.startsAt),
        ...s,
      })),
      isSample: dto.isSample ?? defaultSample,
    },
  };
}

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const file = parseFileArg(process.argv.slice(2));

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const events = mongoose.model<Event>(Event.name, EventSchema);
  const banners = mongoose.model<EventBanner>(EventBanner.name, EventBannerSchema);
  await Promise.all([events.init(), banners.init()]);

  const eventCounts = emptyCounts();
  let source: unknown[];
  if (file) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('The JSON file must contain an array of events');
    source = parsed;
  } else {
    source = SAMPLE_EVENTS;
  }

  for (const [index, raw] of source.entries()) {
    const title = (raw as { title?: string } | null)?.title;
    const label = `#${index + 1}${title ? ` (${title})` : ''}`;
    const result = await toValidEvent(raw, !file);
    if (!result.value) {
      eventCounts.failed += 1;
      console.error(`Event ${label} skipped: ${result.error}`);
      continue;
    }
    const { slug, ...data } = result.value;
    const outcome = await events.updateOne(
      { slug },
      { $set: data },
      { upsert: true, setDefaultsOnInsert: true },
    );
    if (outcome.upsertedCount) eventCounts.created += 1;
    else eventCounts.updated += 1;
  }

  const summary: Record<string, Counts> = { events: eventCounts };

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
  if (eventCounts.failed > 0) process.exitCode = 1;
}

run().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
