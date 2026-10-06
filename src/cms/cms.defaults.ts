import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ContentPayload } from './cms.types';

/**
 * Seed defaults = the content the site shipped with. One JSON file per document key in
 * `<repo>/content/defaults/<key>.json`; the site keeps a generated copy as its fallback
 * (see Tourvex-NextJS `npm run content:sync`). Resolved relative to this file so it works from
 * `src` (ts-jest, tsx) and from `dist`.
 */
export const DEFAULTS_DIR = process.env.CMS_DEFAULTS_DIR
  ? resolve(process.env.CMS_DEFAULTS_DIR)
  : resolve(__dirname, '..', '..', 'content', 'defaults');

const cache = new Map<string, ContentPayload | null>();

export function defaultsFile(key: string): string {
  return join(DEFAULTS_DIR, `${key}.json`);
}

/** The seed payload for a key, or null if no file exists. Returns a fresh deep copy each call. */
export function loadDefaults(key: string): ContentPayload | null {
  if (!/^[a-z][a-z0-9.-]{0,60}$/.test(key)) return null;
  if (!cache.has(key)) {
    const file = defaultsFile(key);
    cache.set(key, existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ContentPayload) : null);
  }
  const value = cache.get(key);
  return value ? (structuredClone(value)) : null;
}
