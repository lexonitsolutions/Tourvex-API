import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../common/cache/cache.service';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import type { FieldChange } from '../audit/redact';
import { appError } from '../common/app-error';
import { loadDefaults } from './cms.defaults';
import { summarizeChanges } from './cms.changes';
import { derivePreviewSecret, signPreviewToken, verifyPreviewToken } from './cms.preview-token';
import { CmsDocument, MAX_REVISIONS } from './cms.schema';
import type { ContentPayload, DocumentSchema, ValidationIssue } from './cms.types';
import { collectStrings, validateDocumentPayload } from './cms.validator';
import {
  getDocumentSchema,
  isSupportedLocale,
  listDocumentKeys,
  MAX_BATCH_KEYS,
  sectionSchemasFor,
} from './schemas';

type Lean = Record<string, any>;

export interface Actor {
  id: string;
  email: string;
}

export type ContentStatus = 'published' | 'draft-changes' | 'never-published';

const DEFAULT_LOCALE = 'en';

export const etagOf = (body: unknown): string =>
  `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`;

@Injectable()
export class CmsService {
  private readonly previewSecret: string;
  private readonly frontendUrl: string;

  constructor(
    @InjectModel(CmsDocument.name) private readonly docs: Model<CmsDocument>,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    this.previewSecret = derivePreviewSecret(
      config.get<string>('CMS_PREVIEW_SECRET'),
      config.get<string>('CLERK_SECRET_KEY'),
    );
    this.frontendUrl = (config.get<string>('FRONTEND_URL', 'http://localhost:3000') ?? '')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
  }

  // ---------------------------------------------------------------- helpers

  resolve(key: string, locale?: string): { schema: DocumentSchema; locale: string } {
    const schema = getDocumentSchema(key);
    if (!schema) throw new NotFoundException({ statusCode: 404, code: 'CONTENT_NOT_FOUND', message: `Unknown content key '${key}'` });
    const resolved = locale ?? DEFAULT_LOCALE;
    if (!isSupportedLocale(resolved)) throw appError(400, 'INVALID_LOCALE', `Unsupported locale '${resolved}'`);
    return { schema, locale: resolved };
  }

  private async find(key: string, locale: string): Promise<Lean | null> {
    return this.docs.findOne({ key, locale }).lean<Lean>().exec();
  }

  private async ensure(key: string, locale: string): Promise<Lean> {
    try {
      const doc = await this.docs
        .findOneAndUpdate(
          { key, locale },
          { $setOnInsert: { key, locale, draft: null, published: null, version: 0, draftRevision: 0, revisions: [] } },
          { upsert: true, returnDocument: 'after' },
        )
        .lean<Lean>()
        .exec();
      if (doc) return doc;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    return (await this.find(key, locale)) as Lean;
  }

  private publishedPayload(key: string, doc: Lean | null): ContentPayload {
    const raw = ((doc?.published as ContentPayload | null) ?? loadDefaults(key) ?? ({ data: {} }));
    if (key === 'page.home' && raw && Array.isArray((raw as Lean).sections)) {
      const defaults = loadDefaults('page.home') as Lean | null;
      if (defaults && Array.isArray(defaults.sections)) {
        const existing = new Set((raw as Lean).sections.map((s: Lean) => s.type));
        const missing = defaults.sections.filter((s: Lean) => !existing.has(s.type));
        if (missing.length > 0) {
          const sections = [...(raw as Lean).sections];
          for (const m of missing) {
            const defIdx = defaults.sections.findIndex((s: Lean) => s.type === m.type);
            if (defIdx !== -1 && defIdx < sections.length) {
              sections.splice(defIdx, 0, m);
            } else {
              sections.push(m);
            }
          }
          return { ...(raw as object), sections } as ContentPayload;
        }
      }
    }
    return raw;
  }

  private statusOf(doc: Lean | null): ContentStatus {
    if (!doc || !doc.version) return 'never-published';
    return doc.draft ? 'draft-changes' : 'published';
  }

  private validate(schema: DocumentSchema, raw: unknown): { value: ContentPayload; issues: ValidationIssue[] } {
    const result = validateDocumentPayload(schema, sectionSchemasFor(schema), raw);
    return { value: result.value as ContentPayload, issues: result.issues };
  }

  private failValidation(issues: ValidationIssue[]): HttpException {
    return new HttpException(
      { statusCode: 400, code: 'VALIDATION_FAILED', message: 'The content has validation errors', errors: issues },
      400,
    );
  }

  // ---------------------------------------------------------------- public

  private publicItem(key: string, locale: string, doc: Lean | null, draft?: ContentPayload) {
    const payload = draft ?? this.publishedPayload(key, doc);
    return {
      key,
      locale,
      version: draft ? (doc?.version ?? 0) : (doc?.version ?? 0),
      publishedAt: draft ? null : ((doc?.publishedAt as Date | null) ?? null),
      ...payload,
    };
  }

  /** Published payload, or the draft when a valid preview token for this key is supplied. */
  async getPublic(key: string, localeInput?: string, previewToken?: string) {
    const { locale } = this.resolve(key, localeInput);
    const doc = await this.find(key, locale);
    if (previewToken) {
      const verdict = verifyPreviewToken(this.previewSecret, previewToken, key, locale);
      if (!verdict.valid) {
        throw appError(403, 'PREVIEW_INVALID', `Preview token rejected (${verdict.reason})`);
      }
      const draft = ((doc?.draft as ContentPayload | null) ?? undefined);
      return { body: this.publicItem(key, locale, doc, draft), preview: true };
    }
    return { body: this.publicItem(key, locale, doc), preview: false };
  }

  /** Published content is the same for every visitor, so it is cached; a draft preview never is. */
  getPublicBatch(keysParam: string, localeInput?: string, previewToken?: string) {
    if (previewToken) return this.getPublicBatchUncached(keysParam, localeInput, previewToken);
    return this.cache.wrap('cms', `batch:${localeInput ?? ''}:${keysParam}`, 30, () => this.getPublicBatchUncached(keysParam, localeInput));
  }

  private async getPublicBatchUncached(keysParam: string, localeInput?: string, previewToken?: string) {
    const keys = [...new Set(keysParam.split(',').map((k) => k.trim()).filter(Boolean))];
    if (keys.length === 0) throw appError(400, 'KEYS_REQUIRED', 'keys is required');
    if (keys.length > MAX_BATCH_KEYS) throw appError(400, 'TOO_MANY_KEYS', `At most ${MAX_BATCH_KEYS} keys per request`);
    const items: Record<string, unknown> = {};
    let preview = false;
    for (const key of keys) {
      const { locale } = this.resolve(key, localeInput);
      const doc = await this.find(key, locale);
      let draft: ContentPayload | undefined;
      if (previewToken) {
        const verdict = verifyPreviewToken(this.previewSecret, previewToken, key, locale);
        if (verdict.valid) {
          draft = ((doc?.draft as ContentPayload | null) ?? undefined);
          preview = true;
        } else if (verdict.reason !== 'key') {
          throw appError(403, 'PREVIEW_INVALID', `Preview token rejected (${verdict.reason})`);
        }
      }
      items[key] = this.publicItem(key, locale, doc, draft);
    }
    return { body: { items }, preview };
  }

  // ---------------------------------------------------------------- admin

  async list(localeInput?: string) {
    const locale = this.resolve(listDocumentKeys()[0], localeInput).locale;
    const docs = await this.docs.find({ locale }).lean<Lean[]>().exec();
    const byKey = new Map(docs.map((doc) => [doc.key as string, doc]));
    return listDocumentKeys().map((key) => {
      const schema = getDocumentSchema(key) as DocumentSchema;
      const doc = byKey.get(key) ?? null;
      const draftNewer = doc?.draft && doc.draftUpdatedAt && (!doc.publishedAt || doc.draftUpdatedAt > doc.publishedAt);
      const updatedAt = draftNewer ? doc?.draftUpdatedAt : (doc?.publishedAt ?? null);
      const updatedBy = draftNewer ? doc?.draftUpdatedBy : doc?.publishedBy;
      return {
        key,
        label: schema.label,
        kind: schema.kind,
        locale,
        status: this.statusOf(doc),
        version: doc?.version ?? 0,
        updatedAt: updatedAt ?? null,
        updatedBy: updatedBy?.email ?? null,
      };
    });
  }

  private view(schema: DocumentSchema, locale: string, doc: Lean | null) {
    const published = this.publishedPayload(schema.key, doc);
    const hasDraft = Boolean(doc?.draft);
    let draft = (doc?.draft as ContentPayload | null) ?? published;
    // Early drafts created while schemas were being introduced could contain only
    // empty list rows. Hydrate those rows from the populated defaults so existing content is visible
    // in the editor instead of presenting an apparently blank page. Published content is never changed.
    if ((schema.key === 'page.events' || schema.key === 'page.holidays' || schema.key === 'page.voyager') && !doc?.version && doc?.draft) {
      const defaults = published as Lean;
      const current = doc.draft as Lean;
      const currentByType = new Map((current.sections ?? []).map((section: Lean) => [section.type, section]));
      draft = {
        sections: (defaults.sections ?? []).map((fallback: Lean) => {
          const section = currentByType.get(fallback.type) as Lean | undefined;
          if (!section) return fallback;
          const data = { ...(fallback.data ?? {}), ...(section.data ?? {}) };
          if (fallback.type === 'eventsHero' && !(data.banners ?? []).some((item: Lean) => item.title?.trim() && item.image?.url)) data.banners = fallback.data.banners;
          if (fallback.type === 'eventsCategories' && !(data.categories ?? []).some((item: Lean) => item.category?.trim())) data.categories = fallback.data.categories;
          if (fallback.type === 'eventsTrendingCities' && !(data.cities ?? []).some((item: Lean) => item.city?.trim())) data.cities = fallback.data.cities;
          if ((fallback.type === 'holidaysHero' || fallback.type === 'voyagerHero') && !(data.banners ?? []).some((item: Lean) => item.title?.trim() && (item.image?.url || item.image))) data.banners = fallback.data.banners;
          if ((fallback.type === 'holidaysCities' || fallback.type === 'holidaysCountries' || fallback.type === 'voyagerCities' || fallback.type === 'voyagerCountries') && !(data.items ?? []).some((item: Lean) => item.name?.trim())) data.items = fallback.data.items;
          if (fallback.type === 'holidaysPackages' && !(data.packages ?? []).some((item: Lean) => item.slug?.trim())) data.packages = fallback.data.packages;
          if (fallback.type === 'voyagerCruises' && !(data.cruises ?? []).some((item: Lean) => item.slug?.trim())) data.cruises = fallback.data.cruises;
          return { ...fallback, ...section, data };
        }),
      } as ContentPayload;
    }

    if (schema.key === 'page.home' && draft && Array.isArray((draft as Lean).sections)) {
      const defaults = loadDefaults('page.home') as Lean | null;
      if (defaults && Array.isArray(defaults.sections)) {
        const existing = new Set((draft as Lean).sections.map((s: Lean) => s.type));
        const missing = defaults.sections.filter((s: Lean) => !existing.has(s.type));
        if (missing.length > 0) {
          const sections = [...(draft as Lean).sections];
          for (const m of missing) {
            const defIdx = defaults.sections.findIndex((s: Lean) => s.type === m.type);
            if (defIdx !== -1 && defIdx < sections.length) {
              sections.splice(defIdx, 0, m);
            } else {
              sections.push(m);
            }
          }
          draft = { ...(draft as object), sections } as ContentPayload;
        }
      }
    }

    return {
      key: schema.key,
      locale,
      schema,
      sectionSchemas: sectionSchemasFor(schema),
      draft,
      hasDraft,
      published,
      version: doc?.version ?? 0,
      draftRevision: doc?.draftRevision ?? 0,
      status: this.statusOf(doc),
      previewPath: schema.previewPath ?? '/',
      publishedAt: doc?.publishedAt ?? null,
      publishedBy: doc?.publishedBy?.email ?? null,
      draftUpdatedAt: doc?.draftUpdatedAt ?? null,
      draftUpdatedBy: doc?.draftUpdatedBy?.email ?? null,
    };
  }

  async getAdmin(key: string, localeInput?: string) {
    const { schema, locale } = this.resolve(key, localeInput);
    return this.view(schema, locale, await this.find(key, locale));
  }

  async saveDraft(
    key: string,
    localeInput: string | undefined,
    body: { data?: unknown; sections?: unknown; baseVersion?: number; draftRevision?: number },
    ifMatch: string | undefined,
    actor: Actor,
  ): Promise<{ view: ReturnType<CmsService['view']>; changes: FieldChange[] }> {
    const { schema, locale } = this.resolve(key, localeInput);
    const raw: Record<string, unknown> = {};
    if (body.data !== undefined) raw.data = body.data;
    if (body.sections !== undefined) raw.sections = body.sections;
    const { value, issues } = this.validate(schema, raw);
    if (issues.length) throw this.failValidation(issues);

    const doc = await this.ensure(key, locale);
    let expectedRevision = body.draftRevision;
    let expectedVersion = body.baseVersion;
    const match = /^"?(\d+)\.(\d+)"?$/.exec(ifMatch ?? '');
    if (match) {
      expectedVersion ??= Number(match[1]);
      expectedRevision ??= Number(match[2]);
    }
    const before = this.view(schema, locale, doc).draft;
    const filter: Record<string, unknown> = { key, locale, draftRevision: expectedRevision ?? doc.draftRevision };
    if (expectedVersion !== undefined) filter.version = expectedVersion;
    const updated = await this.docs
      .findOneAndUpdate(
        filter,
        {
          $set: { draft: value, draftUpdatedAt: new Date(), draftUpdatedBy: { id: actor.id, email: actor.email } },
          $inc: { draftRevision: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean<Lean>()
      .exec();
    if (!updated) throw await this.conflict(schema, locale);
    return { view: this.view(schema, locale, updated), changes: summarizeChanges(before, value) };
  }

  private async conflict(schema: DocumentSchema, locale: string): Promise<HttpException> {
    const latest = this.view(schema, locale, await this.find(schema.key, locale));
    return new HttpException(
      {
        statusCode: 409,
        code: 'CONTENT_CONFLICT',
        message: 'This document changed since you loaded it',
        latest,
      },
      409,
    );
  }

  async publish(key: string, localeInput: string | undefined, note: string | undefined, expectedRevision: number | undefined, actor: Actor) {
    const { schema, locale } = this.resolve(key, localeInput);
    const doc = await this.find(key, locale);
    if (!doc?.draft) throw appError(409, 'NO_DRAFT', 'There are no unpublished changes to publish');
    if (expectedRevision !== undefined && expectedRevision !== doc.draftRevision) throw await this.conflict(schema, locale);
    const { value, issues } = this.validate(schema, doc.draft);
    if (issues.length) throw this.failValidation(issues);

    const now = new Date();
    const version = (doc.version as number) + 1;
    const by = { id: actor.id, email: actor.email };
    const before = this.publishedPayload(key, doc);
    const updated = await this.docs
      .findOneAndUpdate(
        { key, locale, version: doc.version, draftRevision: doc.draftRevision },
        {
          $set: { published: value, version, publishedAt: now, publishedBy: by, draft: null },
          $unset: { draftUpdatedAt: '', draftUpdatedBy: '' },
          $inc: { draftRevision: 1 },
          $push: {
            revisions: {
              $each: [{ version, data: value, publishedAt: now, publishedBy: by, note: (note ?? '').trim().slice(0, 200) }],
              $slice: -MAX_REVISIONS,
            },
          },
        },
        { returnDocument: 'after' },
      )
      .lean<Lean>()
      .exec();
    if (!updated) throw await this.conflict(schema, locale);
    await this.cache.invalidate('cms');
    return { view: this.view(schema, locale, updated), changes: summarizeChanges(before, value) };
  }

  async discard(key: string, localeInput: string | undefined) {
    const { schema, locale } = this.resolve(key, localeInput);
    const doc = await this.find(key, locale);
    if (!doc?.draft) return { view: this.view(schema, locale, doc), changes: [] as FieldChange[] };
    const updated = await this.docs
      .findOneAndUpdate(
        { key, locale },
        { $set: { draft: null }, $unset: { draftUpdatedAt: '', draftUpdatedBy: '' }, $inc: { draftRevision: 1 } },
        { returnDocument: 'after' },
      )
      .lean<Lean>()
      .exec();
    return { view: this.view(schema, locale, updated), changes: summarizeChanges(doc.draft, this.publishedPayload(key, doc)) };
  }

  async listRevisions(key: string, localeInput?: string) {
    const { locale } = this.resolve(key, localeInput);
    const doc = await this.find(key, locale);
    return ((doc?.revisions ?? []) as Lean[])
      .map((r) => ({ version: r.version, publishedAt: r.publishedAt, publishedBy: r.publishedBy?.email ?? null, note: r.note ?? '' }))
      .sort((a, b) => b.version - a.version);
  }

  private async revision(key: string, locale: string, version: number): Promise<Lean> {
    const doc = await this.find(key, locale);
    const found = ((doc?.revisions ?? []) as Lean[]).find((r) => r.version === version);
    if (!found) throw new NotFoundException({ statusCode: 404, code: 'REVISION_NOT_FOUND', message: `Revision ${version} was not found` });
    return found;
  }

  async getRevision(key: string, localeInput: string | undefined, version: number) {
    const { locale } = this.resolve(key, localeInput);
    const r = await this.revision(key, locale, version);
    return {
      version: r.version,
      publishedAt: r.publishedAt,
      publishedBy: r.publishedBy?.email ?? null,
      note: r.note ?? '',
      ...(r.data as ContentPayload),
    };
  }

  /** Loads a revision into the DRAFT. Never publishes. */
  async restore(key: string, localeInput: string | undefined, version: number, actor: Actor) {
    const { schema, locale } = this.resolve(key, localeInput);
    const r = await this.revision(key, locale, version);
    const { value, issues } = this.validate(schema, r.data);
    if (issues.length) throw this.failValidation(issues);
    const doc = await this.ensure(key, locale);
    const before = this.view(schema, locale, doc).draft;
    const updated = await this.docs
      .findOneAndUpdate(
        { key, locale },
        {
          $set: { draft: value, draftUpdatedAt: new Date(), draftUpdatedBy: { id: actor.id, email: actor.email } },
          $inc: { draftRevision: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean<Lean>()
      .exec();
    return { view: this.view(schema, locale, updated), changes: summarizeChanges(before, value) };
  }

  createPreview(key: string, localeInput?: string) {
    const { schema, locale } = this.resolve(key, localeInput);
    const { token, expiresAt } = signPreviewToken(this.previewSecret, key, locale);
    const path = schema.previewPath ?? '/';
    return {
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      url: `${this.frontendUrl}${path}${path.includes('?') ? '&' : '?'}cmsPreview=${token}`,
    };
  }

  // ---------------------------------------------------------------- seeding / media references

  /** Idempotent seed of one key; `force` overwrites. Returns what happened. */
  async seed(key: string, force: boolean, actor?: Actor): Promise<'created' | 'skipped' | 'overwritten' | 'failed'> {
    const { schema, locale } = this.resolve(key);
    const defaults = loadDefaults(key);
    if (!defaults) return 'failed';
    const { value, issues } = this.validate(schema, defaults);
    if (issues.length) throw this.failValidation(issues);
    const existing = await this.find(key, locale);
    if (existing && (existing.published || existing.draft) && !force) return 'skipped';
    const now = new Date();
    const version = ((existing?.version as number | undefined) ?? 0) + 1;
    const by = actor ? { id: actor.id, email: actor.email } : { email: 'seed' };
    await this.docs
      .updateOne(
        { key, locale },
        {
          $set: { published: value, draft: null, version, publishedAt: now, publishedBy: by },
          $unset: { draftUpdatedAt: '', draftUpdatedBy: '' },
          $inc: { draftRevision: 1 },
          $push: {
            revisions: {
              $each: [{ version, data: value, publishedAt: now, publishedBy: by, note: force ? 'Re-seeded from defaults' : 'Initial seed' }],
              $slice: -MAX_REVISIONS,
            },
          },
        },
        { upsert: true },
      )
      .exec();
    return existing ? 'overwritten' : 'created';
  }

  /** Documents whose draft or published payload mention the media file (by filename). */
  async findMediaReferences(filename: string): Promise<{ key: string; locale: string; where: 'published' | 'draft' }[]> {
    const docs = await this.docs.find({}).select({ key: 1, locale: 1, draft: 1, published: 1 }).lean<Lean[]>().exec();
    const refs: { key: string; locale: string; where: 'published' | 'draft' }[] = [];
    const mentions = (payload: unknown) => {
      let hit = false;
      collectStrings(payload, (text) => {
        if (text.endsWith(`/${filename}`) || text === filename) hit = true;
      });
      return hit;
    };
    for (const doc of docs) {
      if (mentions(doc.published)) refs.push({ key: doc.key, locale: doc.locale, where: 'published' });
      if (mentions(doc.draft)) refs.push({ key: doc.key, locale: doc.locale, where: 'draft' });
    }
    return refs;
  }

  /**
   * Calculates homepage achievement metrics dynamically from database collections.
   * If records are absent or 0, fallback is provided so admin-verified counts can take over.
   */
  async getHomepageStats(foundingYear = 2011): Promise<{
    travelers: number;
    years: number;
    trips: number;
    places: number;
  }> {
    const currentYear = new Date().getFullYear();
    const yearsCalculated = Math.max(currentYear - (foundingYear || 2011), 1);
    const defaultStats = {
      travelers: 0,
      years: yearsCalculated,
      trips: 0,
      places: 0,
    };

    try {
      const db = this.docs.db;
      if (!db) return defaultStats;

      // 1. Happy Travelers: aggregate confirmed/completed guest count from bookings
      let travelersCount = 0;
      try {
        const bookingsCol = db.collection('bookings');
        const travelerAgg = await bookingsCol
          .aggregate<{ total: number }>([
            {
              $match: {
                status: { $in: ['confirmed', 'completed'] },
              },
            },
            {
              $group: {
                _id: null,
                total: {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          {
                            $add: [
                              { $ifNull: ['$adults', 0] },
                              { $ifNull: ['$children', 0] },
                            ],
                          },
                          0,
                        ],
                      },
                      {
                        $add: [
                          { $ifNull: ['$adults', 0] },
                          { $ifNull: ['$children', 0] },
                        ],
                      },
                      { $ifNull: ['$quantity', 1] },
                    ],
                  },
                },
              },
            },
          ])
          .toArray();

        if (travelerAgg.length > 0 && travelerAgg[0]?.total > 0) {
          travelersCount = travelerAgg[0].total;
        } else {
          const count = await bookingsCol.countDocuments({
            status: { $in: ['confirmed', 'completed'] },
          });
          if (count > 0) travelersCount = count;
        }
      } catch {
        // Safe fallback
      }

      // 2. Active published trip options across all travel offerings
      let tripsCount = 0;
      try {
        const [holidays, cruises, activities, events] = await Promise.all([
          db.collection('holidays').countDocuments({ published: true }),
          db.collection('cruises').countDocuments({ published: true }),
          db.collection('activities').countDocuments({ published: true }),
          db.collection('events').countDocuments({ published: true }),
        ]);
        tripsCount = holidays + cruises + activities + events;
      } catch {
        // Safe fallback
      }

      // 3. Unique destinations offered across published packages
      let placesCount = 0;
      try {
        const [holidayDests, activityDests, cruiseDests] = await Promise.all([
          db.collection('holidays').distinct('destinations', { published: true }),
          db.collection('activities').distinct('destinations', { published: true }),
          db.collection('cruises').distinct('destinations', { published: true }),
        ]);
        const set = new Set<string>();
        [holidayDests, activityDests, cruiseDests].forEach((list) => {
          if (Array.isArray(list)) {
            list.forEach((item) => {
              if (typeof item === 'string' && item.trim()) {
                set.add(item.trim().toLowerCase());
              }
            });
          }
        });
        placesCount = set.size;
      } catch {
        // Safe fallback
      }

      return {
        travelers: travelersCount,
        years: yearsCalculated,
        trips: tripsCount,
        places: placesCount,
      };
    } catch {
      return defaultStats;
    }
  }
}
