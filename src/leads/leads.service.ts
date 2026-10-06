import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { StaffDirectoryService } from '../admin/staff-directory/staff-directory.service';
import { diffChanges, type FieldChange } from '../audit/redact';
import { appError } from '../common/app-error';
import { CounterService, formatSequence } from '../common/counters/counters';
import { buildNote, type Note } from '../common/notes/notes';
import {
  buildPagination,
  escapeRegex,
  parseSort,
  skipFor,
} from '../common/query/paging-query.dto';
import {
  AssignLeadDto,
  BulkAssignDto,
  BulkStatusDto,
  ChangeLeadStatusDto,
  FollowUpDto,
  ListLeadsDto,
  LogContactDto,
  UpdateLeadDto,
} from './dto/leads.dto';
import { Lead, type LeadTimelineEntry, type TimelineType } from './lead.schema';
import {
  defaultPriority,
  dubaiDayBounds,
  evaluateTransition,
  followUpState,
  LEAD_STATUSES,
  type LeadSeed,
  type LeadStatus,
  mapLegacyStatus,
  normalizePhone,
  OPEN_STATUSES,
} from './leads.rules';

export interface Actor {
  id: string;
  name: string;
}

export interface LeadResult {
  lead: LeadView;
  summary: string;
  changes: FieldChange[];
}

export interface LeadView {
  id: string;
  reference: string;
  source: string;
  sourceRef: string;
  catalog: { type: string; slug: string; title: string | null; id: string | null } | null;
  name: string;
  email: string;
  phone: string | null;
  phoneNormalized: string | null;
  nationality: string | null;
  subject: string | null;
  message: string | null;
  pax: number | null;
  adults: number | null;
  children: number | null;
  travelDate: Date | null;
  valueAed: number | null;
  status: string;
  lostReason: string | null;
  priority: string;
  owner: { id: string; name: string } | null;
  nextFollowUpAt: Date | null;
  followUp: string;
  lastContactedAt: Date | null;
  closedAt: Date | null;
  tags: string[];
  marketingOptOut: boolean;
  consentAt: Date;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Only on the detail view. */
  notes?: Note[];
  timeline?: LeadTimelineEntry[];
  related?: { sameEmail: number };
}

const LEAD_SORTS = ['createdAt', 'updatedAt', 'nextFollowUpAt', 'name', 'status', 'priority', 'valueAed'] as const;
const BOARD_COLUMN_LIMIT = 40;

const oid = (id: string) => new Types.ObjectId(id);

/** Real transition `$set`/`$unset` for a status change. */
function statusPatch(to: LeadStatus, lostReason: string | undefined, now: Date) {
  const closed = to === 'won' || to === 'lost';
  const $set: Record<string, unknown> = { status: to };
  const $unset: Record<string, ''> = {};
  if (to === 'lost') $set.lostReason = lostReason;
  else $unset.lostReason = '';
  if (closed) {
    $set.closedAt = now;
    $unset.nextFollowUpAt = '';
  } else $unset.closedAt = '';
  return { $set, $unset };
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    private readonly counters: CounterService,
    private readonly staff: StaffDirectoryService,
  ) {}

  // ------------------------------------------------------------------ capture (used by the site modules)

  /**
   * Idempotent by (source, sourceRef): a repeat call returns the existing lead. Never throws for
   * infrastructure reasons when called through `captureSafe`.
   */
  async capture(seed: LeadSeed): Promise<{ id: string; reference: string; created: boolean }> {
    const sourceRef = seed.sourceRef.trim().toUpperCase();
    const existing = await this.leads
      .findOne({ source: seed.source, sourceRef })
      .select({ reference: 1 })
      .lean<Lead>()
      .exec();
    if (existing) return { id: existing._id.toString(), reference: existing.reference, created: false };

    const now = seed.createdAt ?? new Date();
    const legacy = seed.legacyStatus ? mapLegacyStatus(seed.legacyStatus) : { status: 'new' as LeadStatus };
    const timeline: LeadTimelineEntry[] = [
      this.entry('created', undefined, { to: 'new', text: seed.legacyStatus ? 'Imported from the enquiry list' : undefined, at: now }),
    ];
    if (legacy.status !== 'new') {
      timeline.push(
        this.entry('imported', undefined, {
          from: 'new',
          to: legacy.status,
          text: seed.legacyNote ? `Previous status kept. Note: ${seed.legacyNote}`.slice(0, 500) : 'Status carried over from the enquiry list',
          at: now,
        }),
      );
    } else if (seed.legacyNote) {
      timeline.push(this.entry('imported', undefined, { text: `Note from the enquiry list: ${seed.legacyNote}`.slice(0, 500), at: now }));
    }

    const reference = formatSequence('LD', await this.counters.next('lead'));
    try {
      const created = await this.leads.create({
        reference,
        source: seed.source,
        sourceRef,
        ...(seed.sourceId && Types.ObjectId.isValid(seed.sourceId) ? { sourceId: oid(seed.sourceId) } : {}),
        ...(seed.catalog
          ? {
              catalog: {
                type: seed.catalog.type,
                slug: seed.catalog.slug,
                title: seed.catalog.title,
                ...(seed.catalog.id && Types.ObjectId.isValid(seed.catalog.id) ? { id: oid(seed.catalog.id) } : {}),
              },
            }
          : {}),
        name: seed.name,
        email: seed.email,
        phone: seed.phone,
        nationality: seed.nationality,
        subject: seed.subject?.slice(0, 200),
        message: seed.message?.slice(0, 2000),
        pax: seed.pax,
        adults: seed.adults,
        children: seed.children,
        travelDate: seed.travelDate,
        valueAed: seed.valueAed,
        marketingOptOut: seed.marketingOptOut ?? false,
        consentAt: seed.consentAt,
        ...(seed.userId && Types.ObjectId.isValid(seed.userId) ? { userId: oid(seed.userId) } : {}),
        status: legacy.status,
        ...(legacy.lostReason ? { lostReason: legacy.lostReason } : {}),
        ...(legacy.status === 'won' || legacy.status === 'lost' ? { closedAt: now } : {}),
        priority: defaultPriority(seed),
        timeline,
        ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
      });
      return { id: created._id.toString(), reference, created: true };
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        const raced = await this.leads
          .findOne({ source: seed.source, sourceRef })
          .select({ reference: 1 })
          .lean<Lead>()
          .exec();
        if (raced) return { id: raced._id.toString(), reference: raced.reference, created: false };
      }
      throw error;
    }
  }

  /** For public endpoints: the enquiry itself is already saved, so a CRM failure must not fail it. */
  async captureSafe(seed: LeadSeed): Promise<string | null> {
    try {
      return (await this.capture(seed)).reference;
    } catch (error) {
      // Reference only: never log the visitor's details.
      this.logger.error(`Lead capture failed for ${seed.source} ${seed.sourceRef}: ${(error as Error).message}`);
      return null;
    }
  }

  /** Public contact form and activity enquiries: the lead IS the record (no separate enquiry document). */
  async createPublic(
    input: {
      source: 'contact' | 'activity';
      name: string;
      email: string;
      phone?: string;
      subject?: string;
      message?: string;
      pax?: number;
      travelDate?: Date;
      catalog?: LeadSeed['catalog'];
      userId?: string;
    },
  ): Promise<{ reference: string; sourceRef: string }> {
    const prefix = input.source === 'contact' ? 'CON' : 'ACT';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sourceRef = `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
      const done = await this.capture({
        ...input,
        sourceRef,
        consentAt: new Date(),
      });
      if (done.created) return { reference: done.reference, sourceRef };
    }
    throw appError(500, 'LEAD_NOT_RECORDED', 'Could not record your message, please try again');
  }

  // ------------------------------------------------------------------ admin reads

  async list(query: ListLeadsDto, actorId: string) {
    const filter = this.buildFilter(query, actorId, new Date());
    const sort = parseSort(query.sort, LEAD_SORTS, { field: 'createdAt', dir: -1 });
    const [rows, total] = await Promise.all([
      this.leads
        .find(filter)
        .select({ notes: 0, timeline: 0 })
        .sort(sort)
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<Lead[]>()
        .exec(),
      this.leads.countDocuments(filter).exec(),
    ]);
    const names = await this.staff.namesFor(rows.flatMap((r) => (r.ownerId ? [r.ownerId.toString()] : [])));
    return {
      items: rows.map((row) => this.toView(row, names)),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }

  /** Kanban data: per status the count, value and the newest cards, plus the headline numbers. */
  async pipeline(query: ListLeadsDto, actorId: string) {
    const now = new Date();
    const filter = this.buildFilter({ ...query, status: undefined }, actorId, now);
    const [counts, openFilterCounts] = await Promise.all([
      this.leads
        .aggregate<{ _id: string; count: number; value: number }>([
          { $match: filter },
          { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$valueAed', 0] } } } },
        ])
        .exec(),
      this.headline(now),
    ]);
    const columns = await Promise.all(
      LEAD_STATUSES.map(async (status) => {
        const found = counts.find((c) => c._id === status);
        const rows = await this.leads
          .find({ ...filter, status })
          .select({ notes: 0, timeline: 0, message: 0 })
          .sort({ updatedAt: -1, _id: -1 })
          .limit(BOARD_COLUMN_LIMIT)
          .lean<Lead[]>()
          .exec();
        const names = await this.staff.namesFor(rows.flatMap((r) => (r.ownerId ? [r.ownerId.toString()] : [])));
        return {
          status,
          count: found?.count ?? 0,
          valueAed: found?.value ?? 0,
          items: rows.map((row) => this.toView(row, names, now)),
        };
      }),
    );
    return { columns, totals: openFilterCounts, limitPerColumn: BOARD_COLUMN_LIMIT };
  }

  /** Org-wide counters shown above the CRM (not affected by filters). */
  async headline(now = new Date()) {
    const { end } = dubaiDayBounds(now);
    const open = { status: { $in: OPEN_STATUSES } };
    const [openCount, overdue, dueToday, unassigned, newCount] = await Promise.all([
      this.leads.countDocuments(open).exec(),
      this.leads.countDocuments({ ...open, nextFollowUpAt: { $lt: now } }).exec(),
      this.leads.countDocuments({ ...open, nextFollowUpAt: { $gte: now, $lt: end } }).exec(),
      this.leads.countDocuments({ ...open, ownerId: { $exists: false } }).exec(),
      this.leads.countDocuments({ status: 'new' }).exec(),
    ]);
    return { open: openCount, new: newCount, overdue, dueToday, unassigned };
  }

  async get(id: string): Promise<LeadView> {
    const doc = await this.find(id);
    const names = await this.staff.namesFor(doc.ownerId ? [doc.ownerId.toString()] : []);
    const view = this.toView(doc, names);
    view.notes = doc.notes ?? [];
    view.timeline = [...(doc.timeline ?? [])].sort((a, b) => b.at.getTime() - a.at.getTime());
    const sameEmail = await this.leads.countDocuments({ email: doc.email, _id: { $ne: doc._id } }).exec();
    view.related = { sameEmail };
    return view;
  }

  /** The acting staff member as recorded in notes and the timeline. */
  async actorFor(user: { sub: string; email: string }): Promise<Actor> {
    const name = (await this.staff.namesFor([user.sub])).get(user.sub);
    return { id: user.sub, name: name || user.email };
  }

  owners() {
    return this.staff.assignable('enquiries.write');
  }

  async *exportRows(query: ListLeadsDto, actorId: string): AsyncGenerator<LeadView> {
    const filter = this.buildFilter(query, actorId, new Date());
    const sort = parseSort(query.sort, LEAD_SORTS, { field: 'createdAt', dir: -1 });
    const cursor = this.leads.find(filter).select({ notes: 0, timeline: 0 }).sort(sort).limit(10_001).lean<Lead[]>().cursor();
    const names = new Map<string, string>();
    for await (const row of cursor) {
      if (row.ownerId && !names.has(row.ownerId.toString())) {
        for (const [k, v] of await this.staff.namesFor([row.ownerId.toString()])) names.set(k, v);
      }
      yield this.toView(row, names);
    }
  }

  // ------------------------------------------------------------------ admin mutations

  async update(id: string, dto: UpdateLeadDto, actor: Actor): Promise<LeadResult> {
    if (dto.priority === undefined && dto.tags === undefined && dto.valueAed === undefined) {
      throw appError(400, 'NOTHING_TO_UPDATE', 'Provide priority, tags or valueAed');
    }
    const before = await this.find(id);
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    const entries: LeadTimelineEntry[] = [];
    if (dto.priority !== undefined && dto.priority !== before.priority) {
      $set.priority = dto.priority;
      entries.push(this.entry('priority', actor, { from: before.priority, to: dto.priority }));
    }
    if (dto.tags !== undefined) $set.tags = [...new Set(dto.tags)];
    if (dto.valueAed !== undefined) {
      if (dto.valueAed === null) $unset.valueAed = '';
      else $set.valueAed = dto.valueAed;
    }
    const after = await this.write(before._id, { $set, $unset, entries });
    return this.result(after, 'Updated lead', { priority: before.priority, tags: before.tags, valueAed: before.valueAed ?? null }, { priority: after.priority, tags: after.tags, valueAed: after.valueAed ?? null });
  }

  async assign(id: string, dto: AssignLeadDto, actor: Actor): Promise<LeadResult> {
    const before = await this.find(id);
    const ownerId = dto.ownerId ?? null;
    const target = ownerId ? await this.staff.findAssignable(ownerId, 'enquiries.write') : null;
    if (ownerId && !target) {
      throw appError(400, 'INVALID_OWNER', 'The owner must be an active staff member who can manage enquiries');
    }
    const beforeName = before.ownerId ? (await this.staff.namesFor([before.ownerId.toString()])).get(before.ownerId.toString()) : null;
    const after = await this.write(before._id, {
      $set: ownerId ? { ownerId: oid(ownerId) } : {},
      $unset: ownerId ? {} : { ownerId: '' },
      entries: [this.entry('assigned', actor, { from: beforeName ?? 'Unassigned', to: target?.name ?? 'Unassigned' })],
    });
    return this.result(after, target ? `Assigned lead to ${target.name}` : 'Unassigned lead', { ownerId: before.ownerId?.toString() ?? null }, { ownerId: ownerId });
  }

  async changeStatus(id: string, dto: ChangeLeadStatusDto, actor: Actor): Promise<LeadResult> {
    const before = await this.find(id);
    const to = dto.status as LeadStatus;
    const verdict = evaluateTransition(before.status as LeadStatus, to, dto.lostReason);
    if (!verdict.ok) throw appError(409, verdict.code, verdict.message);
    const now = new Date();
    const patch = statusPatch(to, dto.lostReason, now);
    const after = await this.write(
      before._id,
      { ...patch, entries: [this.entry('status', actor, { from: before.status, to, text: dto.lostReason ? `Reason: ${dto.lostReason}${dto.note ? `. ${dto.note}` : ''}` : dto.note, at: now })] },
      { status: before.status },
    );
    return this.result(after, `Lead ${before.reference} ${before.status} to ${to}`, { status: before.status, lostReason: before.lostReason ?? null }, { status: after.status, lostReason: after.lostReason ?? null });
  }

  async setFollowUp(id: string, dto: FollowUpDto, actor: Actor): Promise<LeadResult> {
    const before = await this.find(id);
    if (!OPEN_STATUSES.includes(before.status as LeadStatus)) {
      throw appError(409, 'LEAD_CLOSED', 'Reopen the lead before scheduling a follow-up');
    }
    const at = dto.at ? new Date(dto.at) : null;
    if (at && at.getTime() < Date.now() - 60_000) {
      throw appError(400, 'FOLLOW_UP_IN_PAST', 'Choose a follow-up time in the future');
    }
    const after = await this.write(before._id, {
      $set: at ? { nextFollowUpAt: at } : {},
      $unset: at ? {} : { nextFollowUpAt: '' },
      entries: [this.entry('follow_up', actor, { from: before.nextFollowUpAt?.toISOString(), to: at?.toISOString() ?? 'cleared', text: dto.note })],
    });
    return this.result(after, at ? 'Scheduled follow-up' : 'Cleared follow-up', { nextFollowUpAt: before.nextFollowUpAt ?? null }, { nextFollowUpAt: at });
  }

  async addNote(id: string, text: string, actor: Actor): Promise<LeadResult> {
    const before = await this.find(id);
    const note = buildNote({ id: actor.id, name: actor.name }, text);
    const after = (await this.leads
      .findOneAndUpdate({ _id: before._id }, { $push: { notes: note } }, { returnDocument: 'after' })
      .lean<Lead>()
      .exec())!;
    return this.result(after, 'Added note to lead', {}, {});
  }

  /** A staff member reached out (mailto/tel/WhatsApp). Logs it and moves a brand-new lead to contacted. */
  async logContact(id: string, dto: LogContactDto, actor: Actor): Promise<LeadResult> {
    const before = await this.find(id);
    const now = new Date();
    const entries = [this.entry('contact', actor, { to: dto.channel, text: dto.note, at: now })];
    const $set: Record<string, unknown> = { lastContactedAt: now };
    const $unset: Record<string, ''> = {};
    if (before.status === 'new') {
      $set.status = 'contacted';
      entries.push(this.entry('status', actor, { from: 'new', to: 'contacted', text: 'Automatically, after the first contact', at: now }));
    }
    const after = await this.write(before._id, { $set, $unset, entries });
    return this.result(after, `Contacted lead by ${dto.channel}`, { status: before.status }, { status: after.status });
  }

  async bulkAssign(dto: BulkAssignDto, actor: Actor) {
    const ownerId = dto.ownerId ?? null;
    const target = ownerId ? await this.staff.findAssignable(ownerId, 'enquiries.write') : null;
    if (ownerId && !target) throw appError(400, 'INVALID_OWNER', 'The owner must be an active staff member who can manage enquiries');
    const entry = this.entry('assigned', actor, { to: target?.name ?? 'Unassigned', text: 'Bulk assignment' });
    const result = await this.leads
      .updateMany(
        { _id: { $in: dto.ids.map(oid) } },
        { ...(ownerId ? { $set: { ownerId: oid(ownerId) } } : { $unset: { ownerId: '' } }), $push: { timeline: entry } },
      )
      .exec();
    return { requested: dto.ids.length, updated: result.modifiedCount };
  }

  /** Applies the same transition rules per lead; leads that cannot make the move are reported, not failed. */
  async bulkStatus(dto: BulkStatusDto, actor: Actor) {
    const to = dto.status as LeadStatus;
    const docs = await this.leads.find({ _id: { $in: dto.ids.map(oid) } }).select({ status: 1, reference: 1 }).lean<Lead[]>().exec();
    const skipped: { id: string; code: string }[] = [];
    let updated = 0;
    const now = new Date();
    for (const doc of docs) {
      const verdict = evaluateTransition(doc.status as LeadStatus, to, dto.lostReason);
      if (!verdict.ok) {
        skipped.push({ id: doc._id.toString(), code: verdict.code });
        continue;
      }
      const patch = statusPatch(to, dto.lostReason, now);
      const res = await this.leads
        .updateOne(
          { _id: doc._id, status: doc.status },
          {
            $set: patch.$set,
            ...(Object.keys(patch.$unset).length ? { $unset: patch.$unset } : {}),
            $push: { timeline: this.entry('status', actor, { from: doc.status, to, text: 'Bulk change', at: now }) },
          },
        )
        .exec();
      if (res.modifiedCount) updated += 1;
      else skipped.push({ id: doc._id.toString(), code: 'CHANGED_MEANWHILE' });
    }
    const missing = dto.ids.length - docs.length;
    for (let i = 0; i < missing; i += 1) skipped.push({ id: 'unknown', code: 'NOT_FOUND' });
    return { requested: dto.ids.length, updated, skipped };
  }

  /** Leads of a customer (by linked account or e-mail), for the customer detail page. */
  async forCustomer(userId: string, email: string, limit = 10) {
    const rows = await this.leads
      .find({ $or: [{ userId: oid(userId) }, { email: email.toLowerCase() }] })
      .select({ notes: 0, timeline: 0, message: 0 })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<Lead[]>()
      .exec();
    return rows.map((row) => this.toView(row, new Map()));
  }

  // ------------------------------------------------------------------ internals

  private async find(id: string): Promise<Lead> {
    const doc = await this.leads.findById(id).lean<Lead>().exec();
    if (!doc) throw appError(404, 'LEAD_NOT_FOUND', 'Lead not found');
    return doc;
  }

  private entry(
    type: TimelineType,
    actor: Actor | undefined,
    extra: { from?: string; to?: string; text?: string; at?: Date } = {},
  ): LeadTimelineEntry {
    return {
      id: randomUUID(),
      at: extra.at ?? new Date(),
      type,
      ...(actor ? { actorId: oid(actor.id), actorName: actor.name } : {}),
      ...(extra.from !== undefined ? { from: extra.from } : {}),
      ...(extra.to !== undefined ? { to: extra.to } : {}),
      ...(extra.text ? { text: extra.text.slice(0, 500) } : {}),
    };
  }

  private async write(
    id: Types.ObjectId,
    patch: { $set?: Record<string, unknown>; $unset?: Record<string, ''>; entries: LeadTimelineEntry[] },
    guard: Record<string, unknown> = {},
  ): Promise<Lead> {
    const update: Record<string, unknown> = { $push: { timeline: { $each: patch.entries } } };
    if (patch.$set && Object.keys(patch.$set).length) update.$set = patch.$set;
    if (patch.$unset && Object.keys(patch.$unset).length) update.$unset = patch.$unset;
    const after = await this.leads
      .findOneAndUpdate({ _id: id, ...guard }, update, { returnDocument: 'after', runValidators: true })
      .lean<Lead>()
      .exec();
    if (!after) {
      throw guard && Object.keys(guard).length
        ? appError(409, 'CHANGED_MEANWHILE', 'The lead was changed by someone else. Reload and try again')
        : appError(404, 'LEAD_NOT_FOUND', 'Lead not found');
    }
    return after;
  }

  private async result(after: Lead, summary: string, before: Record<string, unknown>, now: Record<string, unknown>): Promise<LeadResult> {
    const names = await this.staff.namesFor(after.ownerId ? [after.ownerId.toString()] : []);
    const view = this.toView(after, names);
    view.notes = after.notes ?? [];
    view.timeline = [...(after.timeline ?? [])].sort((a, b) => b.at.getTime() - a.at.getTime());
    return { lead: view, summary, changes: diffChanges(before, now) };
  }

  private buildFilter(query: ListLeadsDto, actorId: string, now: Date): Record<string, any> {
    const filter: Record<string, any> = {};
    if (query.source) filter.source = { $in: query.source.split(',') };
    if (query.status) filter.status = { $in: query.status.split(',') };
    if (query.owner === 'unassigned') filter.ownerId = { $exists: false };
    else if (query.owner === 'me') filter.ownerId = oid(actorId);
    else if (query.owner) filter.ownerId = oid(query.owner);
    if (query.priority) filter.priority = query.priority;
    if (query.tag) filter.tags = query.tag.toLowerCase();
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    if (query.followUp) {
      const { end } = dubaiDayBounds(now);
      const open = { $in: OPEN_STATUSES };
      if (query.followUp === 'overdue') Object.assign(filter, { nextFollowUpAt: { $lt: now }, status: filter.status ?? open });
      if (query.followUp === 'today') Object.assign(filter, { nextFollowUpAt: { $gte: now, $lt: end }, status: filter.status ?? open });
      if (query.followUp === 'due') Object.assign(filter, { nextFollowUpAt: { $lt: end }, status: filter.status ?? open });
      if (query.followUp === 'none') Object.assign(filter, { nextFollowUpAt: { $exists: false } });
    }
    if (query.q) {
      const text = query.q.trim();
      const pattern = new RegExp(escapeRegex(text), 'i');
      const digits = normalizePhone(text).replace(/\D/g, '');
      filter.$or = [
        { name: pattern },
        { email: pattern },
        { reference: pattern },
        { sourceRef: pattern },
        { subject: pattern },
        { 'catalog.slug': pattern },
        { 'catalog.title': pattern },
        ...(digits.length >= 4 ? [{ phone: new RegExp(digits.split('').join('\\D*')) }] : []),
      ];
    }
    return filter;
  }

  private toView(doc: Lead, names: Map<string, string>, now = new Date()): LeadView {
    const ownerId = doc.ownerId?.toString();
    return {
      id: doc._id.toString(),
      reference: doc.reference,
      source: doc.source,
      sourceRef: doc.sourceRef,
      catalog: doc.catalog
        ? { type: doc.catalog.type, slug: doc.catalog.slug, title: doc.catalog.title ?? null, id: doc.catalog.id?.toString() ?? null }
        : null,
      name: doc.name,
      email: doc.email,
      phone: doc.phone ?? null,
      phoneNormalized: doc.phone ? normalizePhone(doc.phone) : null,
      nationality: doc.nationality ?? null,
      subject: doc.subject ?? null,
      message: doc.message ?? null,
      pax: doc.pax ?? null,
      adults: doc.adults ?? null,
      children: doc.children ?? null,
      travelDate: doc.travelDate ?? null,
      valueAed: doc.valueAed ?? null,
      status: doc.status,
      lostReason: doc.lostReason ?? null,
      priority: doc.priority,
      owner: ownerId ? { id: ownerId, name: names.get(ownerId) ?? 'Former staff' } : null,
      nextFollowUpAt: doc.nextFollowUpAt ?? null,
      followUp: followUpState(doc.nextFollowUpAt, doc.status as LeadStatus, now),
      lastContactedAt: doc.lastContactedAt ?? null,
      closedAt: doc.closedAt ?? null,
      tags: doc.tags ?? [],
      marketingOptOut: Boolean(doc.marketingOptOut),
      consentAt: doc.consentAt,
      userId: doc.userId?.toString() ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
