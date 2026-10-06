import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { CounterSchema, CounterService, CrmCounter } from '../src/common/counters/counters';
import { Lead, LeadSchema } from '../src/leads/lead.schema';
import {
  fromCruiseEnquiry,
  fromEventEnquiry,
  fromHolidayEnquiry,
  fromLegacyJsonLead,
  fromVisaEnquiry,
  type LeadSeed,
} from '../src/leads/leads.rules';
import { LeadsService } from '../src/leads/leads.service';

/**
 * One-off, repeatable import of the existing enquiries into the unified `leads` collection:
 * visa_enquiries, cruise_enquiries, event_enquiries, holiday_enquiries and (optionally) the old
 * file based Next.js leads (`--legacy-json ../Tourvex-NextJS/app/data/leads.json`).
 * Idempotent: a lead is created once per (source, reference); existing leads are left untouched.
 * The enquiry collections are only read. Nothing personal is printed (counts only).
 *
 *   npm run leads:backfill [-- --dry-run] [-- --legacy-json <path>]
 */
async function run() {
  const { values } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false }, 'legacy-json': { type: 'string' } },
    strict: true,
  });
  const dryRun = values['dry-run'] === true;
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  try {
    const leadModel = mongoose.model<Lead>(Lead.name, LeadSchema);
    const counterModel = mongoose.model<CrmCounter>(CrmCounter.name, CounterSchema);
    await leadModel.init();
    // Only `capture` is used, which needs the lead model and the counters; the staff directory is not touched.
    const service = new LeadsService(leadModel, new CounterService(counterModel), null as never);

    const db = mongoose.connection;
    const seeds: LeadSeed[] = [];
    const read = async (name: string) => db.collection(name).find({}).sort({ createdAt: 1 }).toArray();
    for (const row of await read('visa_enquiries')) seeds.push(fromVisaEnquiry(row as any));
    for (const row of await read('cruise_enquiries')) seeds.push(fromCruiseEnquiry(row as any));
    for (const row of await read('event_enquiries')) seeds.push(fromEventEnquiry(row as any));
    for (const row of await read('holiday_enquiries')) seeds.push(fromHolidayEnquiry(row as any));

    let legacySkipped = 0;
    if (values['legacy-json']) {
      const file = resolve(process.cwd(), values['legacy-json']);
      let list: unknown[] = [];
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        list = Array.isArray(parsed) ? parsed : [];
      } catch {
        console.warn(`Legacy file ${file} is not valid JSON; skipped.`);
      }
      for (const item of list) {
        const seed = fromLegacyJsonLead(item as Record<string, unknown>);
        if (seed) seeds.push(seed);
        else legacySkipped += 1;
      }
    }

    seeds.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    const summary: Record<string, { created: number; existing: number; failed: number }> = {};
    for (const seed of seeds) {
      const bucket = (summary[seed.source] ??= { created: 0, existing: 0, failed: 0 });
      if (dryRun) {
        const exists = await leadModel.exists({ source: seed.source, sourceRef: seed.sourceRef.toUpperCase() });
        if (exists) bucket.existing += 1;
        else bucket.created += 1;
        continue;
      }
      try {
        const result = await service.capture(seed);
        if (result.created) bucket.created += 1;
        else bucket.existing += 1;
      } catch {
        bucket.failed += 1;
      }
    }
    console.log(JSON.stringify({ dryRun, scanned: seeds.length, legacySkipped, bySource: summary }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
