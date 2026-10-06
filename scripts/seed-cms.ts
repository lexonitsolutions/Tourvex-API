import 'reflect-metadata';
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import mongoose from 'mongoose';
import { CmsService } from '../src/cms/cms.service';
import { CmsDocument, CmsDocumentSchema } from '../src/cms/cms.schema';
import { listDocumentKeys } from '../src/cms/schemas';

/**
 * Seeds the CMS documents from content/defaults/<key>.json (the content the site shipped with).
 * Idempotent: a document that already has a published or draft payload is left alone.
 *   npm run seed:cms                      seed every missing document
 *   npm run seed:cms -- --force page.home overwrite that key with the defaults (history keeps the old version)
 */
async function run() {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
  const args = process.argv.slice(2);
  const forced = new Set<string>();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--force') {
      const key = args[i + 1];
      if (!key || key.startsWith('--')) throw new Error('--force requires a document key, e.g. --force page.home');
      forced.add(key);
      i += 1;
    }
  }
  const known = listDocumentKeys();
  for (const key of forced) if (!known.includes(key)) throw new Error(`Unknown key '${key}'. Known: ${known.join(', ')}`);

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const model = mongoose.model<CmsDocument>(CmsDocument.name, CmsDocumentSchema);
  await model.init();
  const config = { get: (key: string, fallback?: unknown) => process.env[key] ?? fallback } as unknown as ConfigService;
  const service = new CmsService(model, config);

  const result: Record<string, string> = {};
  for (const key of known) result[key] = await service.seed(key, forced.has(key));
  console.log(JSON.stringify({ cms: result }, null, 2));
  await mongoose.disconnect();
  if (Object.values(result).includes('failed')) process.exitCode = 1;
}

run().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
