import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { SettingsService } from '../admin/settings/settings.service';
import { StaffDirectoryService } from '../admin/staff-directory/staff-directory.service';
import { diffChanges, type FieldChange } from '../audit/redact';
import { appError } from '../common/app-error';
import { CounterService } from '../common/counters/counters';
import {
  buildPagination,
  escapeRegex,
  parseSort,
  skipFor,
} from '../common/query/paging-query.dto';
import { Booking } from '../bookings/schemas/booking.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import {
  AssignTicketDto,
  CreateTicketDto,
  ListMyTicketsDto,
  ListTicketsDto,
  StaffReplyDto,
  UpdateTicketDto,
} from './dto/tickets.dto';
import { Ticket, type TicketMessage } from './ticket.schema';
import {
  ACTIVE_STATUSES,
  breachedFilter,
  canCustomerClose,
  canCustomerReopen,
  computeSla,
  formatTicketNumber,
  MAX_ACTIVE_TICKETS_PER_CUSTOMER,
  parseTicketNumber,
  planStaffStatusChange,
  type SlaTargets,
  statusAfterCustomerMessage,
  type TicketStatus,
} from './tickets.rules';

export interface Actor {
  id: string;
  name: string;
}

export interface TicketMessageView {
  id: string;
  authorType: string;
  authorName: string | null;
  body: string;
  internal: boolean;
  at: Date;
}

export interface TicketView {
  id: string;
  number: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  requester: { userId: string | null; name: string | null; email: string | null };
  booking: { id: string; reference: string | null } | null;
  assignee: { id: string; name: string } | null;
  publicMessageCount: number;
  lastMessageAt: Date | null;
  lastMessageBy: string | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sla?: ReturnType<typeof computeSla>;
  messages?: TicketMessageView[];
}

export interface TicketResult {
  ticket: TicketView;
  summary: string;
  changes: FieldChange[];
}

const TICKET_SORTS = ['createdAt', 'updatedAt', 'lastMessageAt', 'priority', 'status', 'number'] as const;
const oid = (id: string) => new Types.ObjectId(id);

@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(Ticket.name) private readonly tickets: Model<Ticket>,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    private readonly counters: CounterService,
    private readonly settings: SettingsService,
    private readonly staff: StaffDirectoryService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** SLA targets from the `support` settings group (defaults 4 h / 48 h). */
  async targets(): Promise<SlaTargets> {
    const values = await this.settings.get('support');
    return {
      firstResponseHours: Number(values.firstResponseHours) || 4,
      resolutionHours: Number(values.resolutionHours) || 48,
    };
  }

  // ------------------------------------------------------------------ customer API

  async createForCustomer(user: { sub: string; email: string }, dto: CreateTicketDto): Promise<TicketView> {
    const active = await this.tickets
      .countDocuments({ 'requester.userId': oid(user.sub), status: { $in: ACTIVE_STATUSES } })
      .exec();
    if (active >= MAX_ACTIVE_TICKETS_PER_CUSTOMER) {
      throw appError(409, 'TOO_MANY_OPEN_TICKETS', 'You have too many open tickets. Please wait for a reply or close one first');
    }
    let booking: { _id: Types.ObjectId; reference: string } | null = null;
    if (dto.bookingId) {
      // Strict ownership: only your own booking can be linked.
      booking = await this.bookings
        .findOne({ _id: oid(dto.bookingId), customerId: oid(user.sub) })
        .select({ reference: 1 })
        .lean<{ _id: Types.ObjectId; reference: string }>()
        .exec();
      if (!booking) throw appError(400, 'BOOKING_NOT_FOUND', 'That booking was not found on your account');
    }
    const profile = await this.users.getProfile(user.sub);
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.email;
    const now = new Date();
    const number = formatTicketNumber(await this.counters.next('ticket'));
    const created = await this.tickets.create({
      number,
      subject: dto.subject,
      category: dto.category,
      priority: dto.category === 'complaint' ? 'high' : 'normal',
      status: 'open',
      requester: { userId: oid(user.sub), name, email: profile.email },
      ...(booking ? { bookingId: booking._id, bookingReference: booking.reference } : {}),
      messages: [this.message('customer', { id: user.sub, name }, dto.body, false, now)],
      lastMessageAt: now,
      lastMessageBy: 'customer',
      publicMessageCount: 1,
    });
    void this.notifications.ticketEvent({ ticketNumber: number, event: 'created' });
    return this.toView(created.toObject(), new Map(), { includeMessages: true, internal: false });
  }

  async listForCustomer(userId: string, query: ListMyTicketsDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const filter = { 'requester.userId': oid(userId) };
    const [rows, total] = await Promise.all([
      this.tickets
        .find(filter)
        .select({ messages: 0 })
        .sort({ lastMessageAt: -1, _id: -1 })
        .skip(skipFor(page, limit))
        .limit(limit)
        .lean<Ticket[]>()
        .exec(),
      this.tickets.countDocuments(filter).exec(),
    ]);
    return {
      items: rows.map((row) => this.toView(row, new Map(), { includeMessages: false, internal: false, customer: true })),
      pagination: buildPagination(page, limit, total),
    };
  }

  async getForCustomer(userId: string, id: string): Promise<TicketView> {
    return this.toView(await this.findOwned(userId, id), new Map(), {
      includeMessages: true,
      internal: false,
      customer: true,
    });
  }

  async customerMessage(user: { sub: string; email: string }, id: string, body: string): Promise<TicketView> {
    const ticket = await this.findOwned(user.sub, id);
    const next = statusAfterCustomerMessage(ticket.status as TicketStatus);
    if (!next) throw appError(409, 'TICKET_CLOSED', 'This ticket is closed. Reopen it to send a message');
    const now = new Date();
    const name = ticket.requester.name || user.email;
    const wasFinished = ticket.status === 'resolved';
    const after = await this.tickets
      .findOneAndUpdate(
        { _id: ticket._id, status: { $ne: 'closed' } },
        {
          $push: { messages: this.message('customer', { id: user.sub, name }, body, false, now) },
          $set: { status: next, lastMessageAt: now, lastMessageBy: 'customer' },
          $inc: { publicMessageCount: 1 },
          ...(wasFinished ? { $unset: { resolvedAt: '' } } : {}),
        },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<Ticket>()
      .exec();
    if (!after) throw appError(409, 'TICKET_CLOSED', 'This ticket is closed. Reopen it to send a message');
    void this.notifications.ticketEvent({ ticketNumber: after.number, event: 'customer_reply' });
    return this.toView(after, new Map(), { includeMessages: true, internal: false, customer: true });
  }

  async customerClose(userId: string, id: string): Promise<TicketView> {
    const ticket = await this.findOwned(userId, id);
    if (!canCustomerClose(ticket.status as TicketStatus)) throw appError(409, 'ALREADY_CLOSED', 'This ticket is already closed');
    const now = new Date();
    const after = await this.tickets
      .findOneAndUpdate(
        { _id: ticket._id },
        {
          $set: { status: 'closed', closedAt: now, ...(ticket.resolvedAt ? {} : { resolvedAt: now }) },
          $push: { messages: this.message('system', undefined, 'Closed by the customer', false, now) },
        },
        { returnDocument: 'after' },
      )
      .lean<Ticket>()
      .exec();
    return this.toView(after!, new Map(), { includeMessages: true, internal: false, customer: true });
  }

  async customerReopen(userId: string, id: string): Promise<TicketView> {
    const ticket = await this.findOwned(userId, id);
    if (!canCustomerReopen(ticket.status as TicketStatus, ticket.closedAt)) {
      throw appError(409, 'CANNOT_REOPEN', 'This ticket cannot be reopened. Please open a new ticket');
    }
    const now = new Date();
    const after = await this.tickets
      .findOneAndUpdate(
        { _id: ticket._id },
        {
          $set: { status: 'open', lastMessageAt: now, lastMessageBy: 'customer' },
          $unset: { resolvedAt: '', closedAt: '' },
          $push: { messages: this.message('system', undefined, 'Reopened by the customer', false, now) },
        },
        { returnDocument: 'after' },
      )
      .lean<Ticket>()
      .exec();
    return this.toView(after!, new Map(), { includeMessages: true, internal: false, customer: true });
  }

  // ------------------------------------------------------------------ staff API

  async list(query: ListTicketsDto, actorId: string) {
    const targets = await this.targets();
    const filter = this.buildFilter(query, actorId, targets);
    const sort = parseSort(query.sort, TICKET_SORTS, { field: 'lastMessageAt', dir: -1 });
    const [rows, total] = await Promise.all([
      this.tickets
        .find(filter)
        .select({ messages: 0 })
        .sort(sort)
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<Ticket[]>()
        .exec(),
      this.tickets.countDocuments(filter).exec(),
    ]);
    const names = await this.staff.namesFor(rows.flatMap((r) => (r.assigneeId ? [r.assigneeId.toString()] : [])));
    return {
      items: rows.map((row) => this.toView(row, names, { includeMessages: false, internal: true, targets })),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }

  async counts(actorId: string) {
    const targets = await this.targets();
    const active = { status: { $in: ACTIVE_STATUSES } };
    const [mine, unassigned, all, overdue, open] = await Promise.all([
      this.tickets.countDocuments({ ...active, assigneeId: oid(actorId) }).exec(),
      this.tickets.countDocuments({ ...active, assigneeId: { $exists: false } }).exec(),
      this.tickets.countDocuments({}).exec(),
      this.tickets.countDocuments(breachedFilter(targets)).exec(),
      this.tickets.countDocuments({ status: 'open' }).exec(),
    ]);
    return { mine, unassigned, all, overdue, open };
  }

  async get(id: string): Promise<TicketView> {
    const ticket = await this.find(id);
    const names = await this.staff.namesFor(ticket.assigneeId ? [ticket.assigneeId.toString()] : []);
    return this.toView(ticket, names, { includeMessages: true, internal: true, targets: await this.targets() });
  }

  assignees() {
    return this.staff.assignable('tickets.write');
  }

  async *exportRows(query: ListTicketsDto, actorId: string): AsyncGenerator<TicketView> {
    const targets = await this.targets();
    const filter = this.buildFilter(query, actorId, targets);
    const sort = parseSort(query.sort, TICKET_SORTS, { field: 'createdAt', dir: -1 });
    const names = new Map<string, string>();
    const cursor = this.tickets.find(filter).select({ messages: 0 }).sort(sort).limit(10_001).lean<Ticket[]>().cursor();
    for await (const row of cursor) {
      if (row.assigneeId && !names.has(row.assigneeId.toString())) {
        for (const [k, v] of await this.staff.namesFor([row.assigneeId.toString()])) names.set(k, v);
      }
      yield this.toView(row, names, { includeMessages: false, internal: true, targets });
    }
  }

  async reply(id: string, dto: StaffReplyDto, actor: Actor): Promise<TicketResult> {
    const before = await this.find(id);
    const internal = Boolean(dto.internal);
    if (!internal && before.status === 'closed') {
      throw appError(409, 'TICKET_CLOSED', 'Reopen the ticket before replying to the customer');
    }
    const now = new Date();
    const message = this.message('staff', actor, dto.body, internal, now);
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    const update: Record<string, unknown> = { $push: { messages: message } };
    let summary = 'Added internal note';
    if (!internal) {
      summary = 'Replied to customer';
      Object.assign($set, { lastMessageAt: now, lastMessageBy: 'staff' });
      if (!before.firstResponseAt) $set.firstResponseAt = now;
      if (!before.assigneeId) $set.assigneeId = oid(actor.id);
      const after = (dto.setStatus ?? 'pending') as TicketStatus;
      if (after !== before.status) {
        const plan = planStaffStatusChange(before.status as TicketStatus, after);
        if (plan.ok) {
          $set.status = plan.plan.status;
          if (plan.plan.resolvedAt === 'set') $set.resolvedAt = now;
          if (plan.plan.resolvedAt === 'clear') $unset.resolvedAt = '';
          if (plan.plan.closedAt === 'clear') $unset.closedAt = '';
        }
      }
      update.$inc = { publicMessageCount: 1 };
    }
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;
    const updated = await this.tickets
      .findOneAndUpdate({ _id: before._id }, update, { returnDocument: 'after', runValidators: true })
      .lean<Ticket>()
      .exec();
    if (!updated) throw appError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    if (!internal) {
      void this.notifications.ticketEvent({
        ticketNumber: updated.number,
        event: updated.status === 'resolved' ? 'resolved' : 'staff_reply',
      });
    }
    return this.result(updated, `${summary} ${updated.number}`, { status: before.status }, { status: updated.status });
  }

  async update(id: string, dto: UpdateTicketDto, actor: Actor): Promise<TicketResult> {
    if (dto.priority === undefined && dto.category === undefined) {
      throw appError(400, 'NOTHING_TO_UPDATE', 'Provide priority or category');
    }
    const before = await this.find(id);
    const $set: Record<string, unknown> = {};
    const notes: string[] = [];
    if (dto.priority && dto.priority !== before.priority) {
      $set.priority = dto.priority;
      notes.push(`Priority ${before.priority} to ${dto.priority}`);
    }
    if (dto.category && dto.category !== before.category) {
      $set.category = dto.category;
      notes.push(`Category ${before.category} to ${dto.category}`);
    }
    const after = await this.apply(before, { $set, notes, actor });
    return this.result(after, `Updated ticket ${after.number}`, { priority: before.priority, category: before.category }, { priority: after.priority, category: after.category });
  }

  async assign(id: string, dto: AssignTicketDto, actor: Actor): Promise<TicketResult> {
    const before = await this.find(id);
    const assigneeId = dto.assigneeId ?? null;
    const target = assigneeId ? await this.staff.findAssignable(assigneeId, 'tickets.write') : null;
    if (assigneeId && !target) {
      throw appError(400, 'INVALID_ASSIGNEE', 'The assignee must be an active staff member who can manage tickets');
    }
    const after = await this.apply(before, {
      $set: assigneeId ? { assigneeId: oid(assigneeId) } : {},
      $unset: assigneeId ? {} : { assigneeId: '' },
      notes: [target ? `Assigned to ${target.name}` : 'Unassigned'],
      actor,
    });
    return this.result(after, target ? `Assigned ${after.number} to ${target.name}` : `Unassigned ${after.number}`, { assigneeId: before.assigneeId?.toString() ?? null }, { assigneeId });
  }

  async changeStatus(id: string, status: string, actor: Actor): Promise<TicketResult> {
    const before = await this.find(id);
    const verdict = planStaffStatusChange(before.status as TicketStatus, status as TicketStatus);
    if (!verdict.ok) throw appError(409, verdict.code, verdict.message);
    const now = new Date();
    const $set: Record<string, unknown> = { status: verdict.plan.status };
    const $unset: Record<string, ''> = {};
    if (verdict.plan.resolvedAt === 'set') $set.resolvedAt = now;
    if (verdict.plan.resolvedAt === 'clear') $unset.resolvedAt = '';
    if (verdict.plan.closedAt === 'set') $set.closedAt = now;
    if (verdict.plan.closedAt === 'clear') $unset.closedAt = '';
    const after = await this.apply(before, { $set, $unset, notes: [`Status ${before.status} to ${status}`], actor, now });
    if (status === 'resolved') void this.notifications.ticketEvent({ ticketNumber: after.number, event: 'resolved' });
    return this.result(after, `Ticket ${after.number} ${before.status} to ${status}`, { status: before.status }, { status: after.status });
  }

  async bulkClose(ids: string[], actor: Actor) {
    const docs = await this.tickets.find({ _id: { $in: ids.map(oid) } }).select({ status: 1, resolvedAt: 1, number: 1 }).lean<Ticket[]>().exec();
    let updated = 0;
    const skipped: { id: string; code: string }[] = [];
    const now = new Date();
    for (const doc of docs) {
      if (doc.status === 'closed') {
        skipped.push({ id: doc._id.toString(), code: 'ALREADY_CLOSED' });
        continue;
      }
      const res = await this.tickets
        .updateOne(
          { _id: doc._id, status: doc.status },
          {
            $set: { status: 'closed', closedAt: now, ...(doc.resolvedAt ? {} : { resolvedAt: now }) },
            $push: { messages: this.message('system', actor, 'Closed in bulk', true, now) },
          },
        )
        .exec();
      if (res.modifiedCount) updated += 1;
      else skipped.push({ id: doc._id.toString(), code: 'CHANGED_MEANWHILE' });
    }
    for (let i = 0; i < ids.length - docs.length; i += 1) skipped.push({ id: 'unknown', code: 'NOT_FOUND' });
    return { requested: ids.length, updated, skipped };
  }

  async actorFor(user: { sub: string; email: string }): Promise<Actor> {
    const name = (await this.staff.namesFor([user.sub])).get(user.sub);
    return { id: user.sub, name: name || user.email };
  }

  /** Tickets of a customer, for the customer detail page. */
  async forCustomer(userId: string, limit = 10) {
    const rows = await this.tickets
      .find({ 'requester.userId': oid(userId) })
      .select({ messages: 0 })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<Ticket[]>()
      .exec();
    return rows.map((row) => this.toView(row, new Map(), { includeMessages: false, internal: true }));
  }

  // ------------------------------------------------------------------ internals

  private async find(id: string): Promise<Ticket> {
    const ticket = await this.tickets.findById(id).lean<Ticket>().exec();
    if (!ticket) throw appError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    return ticket;
  }

  /** Strict ownership: someone else's ticket is indistinguishable from a missing one. */
  private async findOwned(userId: string, id: string): Promise<Ticket> {
    if (!Types.ObjectId.isValid(id)) throw appError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    const ticket = await this.tickets
      .findOne({ _id: oid(id), 'requester.userId': oid(userId) })
      .lean<Ticket>()
      .exec();
    if (!ticket) throw appError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    return ticket;
  }

  private message(
    authorType: 'customer' | 'staff' | 'system',
    author: { id: string; name: string } | undefined,
    body: string,
    internal: boolean,
    at: Date,
  ): TicketMessage {
    return {
      id: randomUUID(),
      authorType,
      ...(author ? { authorId: oid(author.id), authorName: author.name } : {}),
      body: body.trim().slice(0, 5000),
      internal,
      at,
    };
  }

  /** Applies a metadata change and leaves an internal system note in the thread. */
  private async apply(
    before: Ticket,
    change: { $set?: Record<string, unknown>; $unset?: Record<string, ''>; notes: string[]; actor: Actor; now?: Date },
  ): Promise<Ticket> {
    const now = change.now ?? new Date();
    const update: Record<string, unknown> = {
      $push: { messages: { $each: change.notes.map((text) => this.message('system', change.actor, text, true, now)) } },
    };
    if (change.$set && Object.keys(change.$set).length) update.$set = change.$set;
    if (change.$unset && Object.keys(change.$unset).length) update.$unset = change.$unset;
    const after = await this.tickets
      .findOneAndUpdate({ _id: before._id }, update, { returnDocument: 'after', runValidators: true })
      .lean<Ticket>()
      .exec();
    if (!after) throw appError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    return after;
  }

  private async result(after: Ticket, summary: string, before: Record<string, unknown>, now: Record<string, unknown>): Promise<TicketResult> {
    const names = await this.staff.namesFor(after.assigneeId ? [after.assigneeId.toString()] : []);
    return {
      ticket: this.toView(after, names, { includeMessages: true, internal: true, targets: await this.targets() }),
      summary,
      changes: diffChanges(before, now),
    };
  }

  private buildFilter(query: ListTicketsDto, actorId: string, targets: SlaTargets): Record<string, any> {
    const and: Record<string, any>[] = [];
    const active = { status: { $in: ACTIVE_STATUSES } };
    if (query.tab === 'mine') and.push({ ...active, assigneeId: oid(actorId) });
    if (query.tab === 'unassigned') and.push({ ...active, assigneeId: { $exists: false } });
    if (query.tab === 'overdue') and.push(breachedFilter(targets));
    if (query.status) and.push({ status: { $in: query.status.split(',') } });
    if (query.priority) and.push({ priority: query.priority });
    if (query.category) and.push({ category: query.category });
    if (query.assignee) and.push({ assigneeId: oid(query.assignee) });
    if (query.from || query.to) {
      and.push({
        createdAt: {
          ...(query.from ? { $gte: new Date(query.from) } : {}),
          ...(query.to ? { $lte: new Date(query.to) } : {}),
        },
      });
    }
    if (query.q) {
      const text = query.q.trim();
      const pattern = new RegExp(escapeRegex(text), 'i');
      const seq = parseTicketNumber(text);
      and.push({
        $or: [
          { subject: pattern },
          { number: pattern },
          ...(seq !== null ? [{ number: formatTicketNumber(seq) }] : []),
          { 'requester.email': pattern },
          { 'requester.name': pattern },
          { bookingReference: pattern },
        ],
      });
    }
    return and.length ? { $and: and } : {};
  }

  private toView(
    doc: Ticket,
    names: Map<string, string>,
    options: { includeMessages: boolean; internal: boolean; customer?: boolean; targets?: SlaTargets },
  ): TicketView {
    const assigneeId = doc.assigneeId?.toString();
    const view: TicketView = {
      id: doc._id.toString(),
      number: doc.number,
      subject: doc.subject,
      category: doc.category,
      priority: doc.priority,
      status: doc.status,
      requester: {
        userId: doc.requester?.userId?.toString() ?? null,
        name: doc.requester?.name ?? null,
        email: doc.requester?.email ?? null,
      },
      booking: doc.bookingId ? { id: doc.bookingId.toString(), reference: doc.bookingReference ?? null } : null,
      // Customers only learn that someone is on it, never who.
      assignee: options.customer ? null : assigneeId ? { id: assigneeId, name: names.get(assigneeId) ?? 'Former staff' } : null,
      publicMessageCount: doc.publicMessageCount ?? 0,
      lastMessageAt: doc.lastMessageAt ?? null,
      lastMessageBy: doc.lastMessageBy ?? null,
      firstResponseAt: doc.firstResponseAt ?? null,
      resolvedAt: doc.resolvedAt ?? null,
      closedAt: doc.closedAt ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
    if (options.targets) {
      view.sla = computeSla({
        createdAt: doc.createdAt,
        firstResponseAt: doc.firstResponseAt,
        resolvedAt: doc.resolvedAt,
        status: doc.status as TicketStatus,
        targets: options.targets,
      });
    }
    if (options.includeMessages) {
      view.messages = (doc.messages ?? [])
        .filter((m) => options.internal || !m.internal)
        .map((m) => ({
          id: m.id,
          authorType: m.authorType,
          // Customers see "Support team" instead of staff names.
          authorName: options.internal ? (m.authorName ?? null) : m.authorType === 'staff' ? 'Support team' : (m.authorName ?? null),
          body: m.body,
          internal: m.internal,
          at: m.at,
        }));
    }
    return view;
  }
}
