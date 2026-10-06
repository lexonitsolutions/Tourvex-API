import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mongoose from 'mongoose';
import { CreateVisaDto } from '../src/visas/dto/create-visa.dto';
import { VisaBanner, VisaBannerSchema } from '../src/visas/schemas/visa-banner.schema';
import { VisaSection, VisaSectionSchema } from '../src/visas/schemas/visa-section.schema';
import { Visa, VisaSchema } from '../src/visas/schemas/visa.schema';
import { slugify } from '../src/visas/visas.utils';
import { SAMPLE_BANNERS, SAMPLE_SECTIONS, SAMPLE_VISAS } from './data/visas-sample';

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

async function toValidVisa(raw: unknown, defaultSample: boolean) {
  const dto = plainToInstance(CreateVisaDto, raw);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const messages = errors.flatMap((e) =>
      Object.values(e.constraints ?? { [e.property]: 'invalid nested value' }),
    );
    return { error: messages.join('; ') };
  }
  const slug = dto.slug ?? slugify(dto.title);
  if (!slug) return { error: 'could not derive a slug from the title' };
  return { value: { ...dto, slug, isSample: dto.isSample ?? defaultSample } };
}

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const file = parseFileArg(process.argv.slice(2));

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const visas = mongoose.model<Visa>(Visa.name, VisaSchema);
  const sections = mongoose.model<VisaSection>(VisaSection.name, VisaSectionSchema);
  const banners = mongoose.model<VisaBanner>(VisaBanner.name, VisaBannerSchema);
  await Promise.all([visas.init(), sections.init(), banners.init()]);

  const visaCounts = emptyCounts();
  let source: unknown[];
  if (file) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('The JSON file must contain an array of visas');
    source = parsed;
  } else {
    source = SAMPLE_VISAS;
  }

  for (const [index, raw] of source.entries()) {
    const title = (raw as { title?: string } | null)?.title;
    const label = `#${index + 1}${title ? ` (${title})` : ''}`;
    const result = await toValidVisa(raw, !file);
    if (!result.value) {
      visaCounts.failed += 1;
      console.error(`Visa ${label} skipped: ${result.error}`);
      continue;
    }
    const { slug, ...data } = result.value;
    const outcome = await visas.updateOne(
      { slug },
      { $set: data },
      { upsert: true, setDefaultsOnInsert: true },
    );
    if (outcome.upsertedCount) visaCounts.created += 1;
    else visaCounts.updated += 1;
  }

  const summary: Record<string, Counts> = { visas: visaCounts };

  if (!file) {
    const sectionCounts = emptyCounts();
    for (const section of SAMPLE_SECTIONS) {
      const outcome = await sections.updateOne(
        { slug: section.slug },
        { $set: section },
        { upsert: true, setDefaultsOnInsert: true },
      );
      if (outcome.upsertedCount) sectionCounts.created += 1;
      else sectionCounts.updated += 1;
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
    summary.sections = sectionCounts;
    summary.banners = bannerCounts;
  }

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  if (visaCounts.failed > 0) process.exitCode = 1;
}

run().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
