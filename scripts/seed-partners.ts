import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mongoose from 'mongoose';
import { CreatePartnerDto } from '../src/partners/dto/create-partner.dto';
import { Partner, PartnerSchema } from '../src/partners/schemas/partner.schema';
import { SAMPLE_PARTNERS } from './data/partners-sample';

function parseFileArg(argv: string[]): string | undefined {
  const index = argv.indexOf('--file');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('--file requires a path to a JSON file');
  return resolve(process.cwd(), value);
}

/** Same rules as the admin API (DTO validation). `isSample` is true only for the built-in samples unless set. */
async function toValidPartner(raw: unknown, defaultSample: boolean) {
  const { isSample, ...rest } = (raw ?? {}) as Record<string, unknown>;
  const dto = plainToInstance(CreatePartnerDto, rest);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    return { error: errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') };
  }
  return { value: { ...dto, isSample: typeof isSample === 'boolean' ? isSample : defaultSample } };
}

async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const file = parseFileArg(process.argv.slice(2));

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const partners = mongoose.model<Partner>(Partner.name, PartnerSchema);
  await partners.init();

  let source: unknown[];
  if (file) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('The JSON file must contain an array of partners');
    source = parsed;
  } else {
    source = SAMPLE_PARTNERS;
  }

  const counts = { created: 0, updated: 0, failed: 0 };
  for (const [index, raw] of source.entries()) {
    const name = (raw as { name?: string } | null)?.name;
    const result = await toValidPartner(raw, !file);
    if (!result.value) {
      counts.failed += 1;
      console.error(`Partner #${index + 1}${name ? ` (${name})` : ''} skipped: ${result.error}`);
      continue;
    }
    const outcome = await partners
      .updateOne(
        { name: result.value.name },
        { $set: result.value },
        { upsert: true, setDefaultsOnInsert: true, collation: { locale: 'en', strength: 2 } },
      )
      .exec();
    if (outcome.upsertedCount) counts.created += 1;
    else counts.updated += 1;
  }

  console.log(JSON.stringify({ partners: counts }, null, 2));
  await mongoose.disconnect();
  if (counts.failed > 0) process.exitCode = 1;
}

run().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
