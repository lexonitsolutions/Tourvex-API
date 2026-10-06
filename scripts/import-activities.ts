import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { Activity, ActivitySchema } from '../src/catalog/schemas/activity.schema';

interface LegacyActivity {
  id: number;
  slug: string;
  title: string;
  link?: string;
  destinations?: string[];
  activities?: string[];
  tripTypes?: string[];
  difficulty?: string[];
  price?: number | null;
  salePrice?: number | null;
  currency?: string;
  duration?: { days?: number; nights?: number };
  image?: string;
}

function parseActivities(source: string): LegacyActivity[] {
  const startMarker = 'export const activities = ';
  const start = source.indexOf(startMarker);
  const end = source.search(/;\s*export const destinationOptions/);
  if (start < 0 || end < 0) throw new Error('Could not locate activities export in source file');
  return JSON.parse(source.slice(start + startMarker.length, end)) as LegacyActivity[];
}

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const configured =
    process.env.WORDPRESS_ACTIVITIES_FILE ?? '../Tourvex-NextJS/app/data/activities.js';
  const sourceFile = resolve(process.cwd(), configured);
  const legacy = parseActivities(await readFile(sourceFile, 'utf8'));
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const activities = mongoose.model<Activity>(Activity.name, ActivitySchema);
  const items = legacy.map((item) => ({
      legacyId: item.id,
      slug: item.slug,
      title: { en: item.title },
      destinations: item.destinations ?? [],
      categories: item.activities ?? [],
      tripTypes: item.tripTypes ?? [],
      difficulty: item.difficulty ?? [],
      price: item.price == null ? undefined : { amount: item.price, currency: item.currency ?? 'AED' },
      salePrice:
        item.salePrice == null ? undefined : { amount: item.salePrice, currency: item.currency ?? 'AED' },
      durationDays: item.duration?.days,
      durationNights: item.duration?.nights,
      imageUrl: item.image,
      sourceUrl: item.link,
      source: 'karnishtourism-wordpress',
      published: true,
    }));
  const result = await activities.bulkWrite(
    items.map((item) => ({
      updateOne: { filter: { slug: item.slug }, update: { $set: item }, upsert: true },
    })),
  );
  console.log(
    JSON.stringify(
      {
        sourceFile,
        imported: items.length,
        created: result.upsertedCount,
        updated: result.modifiedCount,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

void run();
