import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { STAFF_ROLES } from '../admin/permissions';
import { StaffDirectoryService } from '../admin/staff-directory/staff-directory.service';
import { diffChanges, type FieldChange } from '../audit/redact';
import { appError } from '../common/app-error';
import { buildNote, type Note } from '../common/notes/notes';
import { buildPagination, escapeRegex, parseSort, skipFor } from '../common/query/paging-query.dto';
import { Booking } from '../bookings/schemas/booking.schema';
import { LeadsService } from '../leads/leads.service';
import { TicketsService } from '../tickets/tickets.service';
import { User, UserStatus } from '../users/schemas/user.schema';
import { UserIdentityCache } from '../users/user-identity.cache';
import { B2B_ROLES, isB2B } from './customers.rules';
import { DeactivateCustomerDto, ListCustomersDto, UpdateCustomerDto } from './dto/customers.dto';

export interface BookingStats {
  bookings: number;
  confirmed: number;
  lifetimeValueAed: number;
  otherCurrencyConfirmed: number;
  firstBookingAt: Date | null;
  lastBookingAt: Date | null;
}

export interface CustomerView {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  isB2B: boolean;
  active: boolean;
  status: string;
  linkedToClerk: boolean;
  tags: string[];
  marketingOptOut: boolean;
  createdAt: Date;
  stats: BookingStats;
  partnerCompany: string | null;
  notes?: Note[];
}

export interface CustomerResult {
  customer: CustomerView;
  summary: string;
  changes: FieldChange[];
}

const CUSTOMER_SORTS = ['createdAt', 'firstName', 'email'] as const;
const EMPTY_STATS: BookingStats = {
  bookings: 0,
  confirmed: 0,
  lifetimeValueAed: 0,
  otherCurrencyConfirmed: 0,
  firstBookingAt: null,
  lastBookingAt: null,
};
const oid = (id: string) => new Types.ObjectId(id);
const fullName = (u: Pick<User, 'firstName' | 'lastName' | 'email'>) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

/** Booking aggregates per customer id (read-only; the bookings module owns the collection). */
export async function bookingStatsFor(
  bookings: Model<Booking>,
  ids: Types.ObjectId[],
): Promise<Map<string, BookingStats>> {
  if (!ids.length) return new Map();
  const confirmed = { $eq: ['$status', 'confirmed'] };
  const aed = { $eq: [{ $toUpper: '$currency' }, 'AED'] };
  const rows = await bookings
    .aggregate<{
      _id: Types.ObjectId;
      bookings: number;
      confirmed: number;
      ltv: number;
      other: number;
      first: Date;
      last: Date;
    }>([
      { $match: { customerId: { $in: ids } } },
      {
        $group: {
          _id: '$customerId',
          bookings: { $sum: 1 },
          confirmed: { $sum: { $cond: [confirmed, 1, 0] } },
          ltv: { $sum: { $cond: [{ $and: [confirmed, aed] }, '$total', 0] } },
          other: { $sum: { $cond: [{ $and: [confirmed, { $not: [aed] }] }, 1, 0] } },
          first: { $min: '$createdAt' },
          last: { $max: '$createdAt' },
        },
      },
    ])
    .exec();
  return new Map(
    rows.map((row) => [
      row._id.toString(),
      {
        bookings: row.bookings,
        confirmed: row.confirmed,
        lifetimeValueAed: Math.round(row.ltv * 100) / 100,
        otherCurrencyConfirmed: row.other,
        firstBookingAt: row.first,
        lastBookingAt: row.last,
      },
    ]),
  );
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    private readonly identityCache: UserIdentityCache,
    private readonly staff: StaffDirectoryService,
    private readonly tickets: TicketsService,
    private readonly leads: LeadsService,
  ) {}

  async list(query: ListCustomersDto) {
    const filter = this.buildFilter(query);
    const sort = parseSort(query.sort, CUSTOMER_SORTS, { field: 'createdAt', dir: -1 });
    const [rows, total] = await Promise.all([
      this.users
        .find(filter)
        .select({ internalNotes: 0 })
        .sort(sort)
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<User[]>()
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    const stats = await bookingStatsFor(this.bookings, rows.map((r) => r._id));
    return {
      items: rows.map((row) => this.toView(row, stats.get(row._id.toString()))),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }

  async *exportRows(query: ListCustomersDto): AsyncGenerator<CustomerView> {
    const filter = this.buildFilter(query);
    const sort = parseSort(query.sort, CUSTOMER_SORTS, { field: 'createdAt', dir: -1 });
    const cursor = this.users.find(filter).select({ internalNotes: 0 }).sort(sort).limit(10_001).lean<User[]>().cursor();
    let batch: User[] = [];
    const flush = async function* (self: CustomersService, rows: User[]) {
      const stats = await bookingStatsFor(self.bookings, rows.map((r) => r._id));
      for (const row of rows) yield self.toView(row, stats.get(row._id.toString()));
    };
    for await (const row of cursor) {
      batch.push(row);
      if (batch.length >= 200) {
        yield* flush(this, batch);
        batch = [];
      }
    }
    if (batch.length) yield* flush(this, batch);
  }

  async detail(id: string) {
    const user = await this.findCustomer(id);
    const stats = await bookingStatsFor(this.bookings, [user._id]);
    const [recent, tickets, leads] = await Promise.all([
      this.bookings
        .find({ customerId: user._id })
        .select({ reference: 1, title: 1, status: 1, total: 1, currency: 1, serviceDate: 1, createdAt: 1, serviceType: 1 })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean<Booking[]>()
        .exec(),
      this.tickets.forCustomer(id, 10),
      this.leads.forCustomer(id, user.email, 10),
    ]);
    const view = this.toView(user, stats.get(id));
    view.notes = [...(user.internalNotes ?? [])].sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      ...view,
      preferredLocale: user.preferredLocale ?? null,
      preferredCurrency: user.preferredCurrency ?? null,
      partnerApplication: user.partnerApplication
        ? { status: user.partnerApplication.status, companyName: user.partnerApplication.companyName }
        : null,
      bookings: recent.map((b) => ({
        id: b._id.toString(),
        reference: b.reference,
        title: b.title,
        status: b.status,
        serviceType: b.serviceType,
        total: b.total,
        currency: b.currency,
        serviceDate: b.serviceDate ?? null,
        createdAt: b.createdAt,
      })),
      tickets,
      leads,
    };
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerResult> {
    if (dto.tags === undefined && dto.marketingOptOut === undefined) {
      throw appError(400, 'NOTHING_TO_UPDATE', 'Provide tags or marketingOptOut');
    }
    const before = await this.findCustomer(id);
    const $set: Record<string, unknown> = {};
    if (dto.tags !== undefined) $set.tags = [...new Set(dto.tags)];
    if (dto.marketingOptOut !== undefined) $set.marketingOptOut = dto.marketingOptOut;
    const after = await this.users
      .findOneAndUpdate({ _id: before._id }, { $set }, { returnDocument: 'after' })
      .lean<User>()
      .exec();
    return this.result(after!, `Updated customer ${after!.email}`, { tags: before.tags ?? [], marketingOptOut: Boolean(before.marketingOptOut) }, { tags: after!.tags ?? [], marketingOptOut: Boolean(after!.marketingOptOut) });
  }

  async addNote(id: string, text: string, actor: { id: string; name: string }): Promise<CustomerResult> {
    const before = await this.findCustomer(id);
    const after = await this.users
      .findOneAndUpdate({ _id: before._id }, { $push: { internalNotes: buildNote(actor, text) } }, { returnDocument: 'after' })
      .lean<User>()
      .exec();
    return this.result(after!, `Added note to customer ${after!.email}`, {}, {});
  }

  async setActive(id: string, active: boolean, dto: DeactivateCustomerDto, actorId: string): Promise<CustomerResult> {
    const before = await this.findCustomer(id);
    if (!active && before._id.toString() === actorId) {
      throw appError(409, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
    }
    if ((before.active !== false) === active) {
      throw appError(409, 'NO_CHANGE', active ? 'The account is already active' : 'The account is already deactivated');
    }
    const after = await this.users
      .findOneAndUpdate({ _id: before._id }, { $set: { active } }, { returnDocument: 'after' })
      .lean<User>()
      .exec();
    this.identityCache.invalidate(after!.clerkUserId);
    const verb = active ? 'Reactivated' : 'Deactivated';
    return this.result(after!, `${verb} customer ${after!.email}${dto.reason ? ` (${dto.reason})` : ''}`, { active: before.active !== false }, { active });
  }

  async actorFor(user: { sub: string; email: string }) {
    const name = (await this.staff.namesFor([user.sub])).get(user.sub);
    return { id: user.sub, name: name || user.email };
  }

  // ------------------------------------------------------------------ internals

  private async findCustomer(id: string): Promise<User> {
    const user = await this.users
      .findOne({ _id: oid(id), roles: { $nin: STAFF_ROLES } })
      .lean<User>()
      .exec();
    if (!user) throw appError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    return user;
  }

  private async result(after: User, summary: string, before: Record<string, unknown>, now: Record<string, unknown>): Promise<CustomerResult> {
    const stats = await bookingStatsFor(this.bookings, [after._id]);
    const customer = this.toView(after, stats.get(after._id.toString()));
    customer.notes = [...(after.internalNotes ?? [])].sort((a, b) => b.at.getTime() - a.at.getTime());
    return { customer, summary, changes: diffChanges(before, now) };
  }

  private buildFilter(query: ListCustomersDto): Record<string, any> {
    const filter: Record<string, any> = { roles: { $nin: STAFF_ROLES } };
    const and: Record<string, any>[] = [];
    if (query.status === 'active') and.push({ active: { $ne: false }, status: UserStatus.Active });
    if (query.status === 'inactive') and.push({ $or: [{ active: false }, { status: { $ne: UserStatus.Active } }] });
    if (query.marketingOptOut !== undefined) filter.marketingOptOut = query.marketingOptOut ? true : { $ne: true };
    if (query.b2b === true) filter.roles = { $nin: STAFF_ROLES, $in: B2B_ROLES };
    if (query.b2b === false) filter.roles = { $nin: [...STAFF_ROLES, ...B2B_ROLES] };
    if (query.tag) filter.tags = query.tag.toLowerCase();
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
      and.push({
        $or: [{ email: pattern }, { firstName: pattern }, { lastName: pattern }, { 'partnerApplication.companyName': pattern }],
      });
    }
    if (and.length) filter.$and = and;
    return filter;
  }

  toView(user: User, stats?: BookingStats): CustomerView {
    return {
      id: user._id.toString(),
      name: fullName(user),
      firstName: user.firstName,
      lastName: user.lastName ?? '',
      email: user.email,
      roles: user.roles,
      isB2B: isB2B(user.roles),
      active: user.active !== false && user.status === UserStatus.Active,
      status: user.status,
      linkedToClerk: Boolean(user.clerkUserId),
      tags: user.tags ?? [],
      marketingOptOut: Boolean(user.marketingOptOut),
      createdAt: user.createdAt,
      stats: stats ?? EMPTY_STATS,
      partnerCompany: user.partnerApplication?.companyName ?? null,
    };
  }
}
