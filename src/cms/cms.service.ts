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
    return ((doc?.published as ContentPayload | null) ?? loadDefaults(key) ?? ({ data: {} }));
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
    return {
      key: schema.key,
      locale,
      schema,
      sectionSchemas: sectionSchemasFor(schema),
      draft: (doc?.draft as ContentPayload | null) ?? published,
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
}
