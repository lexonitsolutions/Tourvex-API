import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StaffDirectoryService } from '../admin/staff-directory/staff-directory.service';
import { diffChanges, type FieldChange } from '../audit/redact';
import { appError } from '../common/app-error';
import { Role } from '../common/enums/role.enum';
import { buildPagination, escapeRegex, parseSort, skipFor } from '../common/query/paging-query.dto';
import { Booking } from '../bookings/schemas/booking.schema';
import { PartnerApplicationStatus, User } from '../users/schemas/user.schema';
import { UserIdentityCache } from '../users/user-identity.cache';
import { B2B_ROLES, rolesAfterApproval } from './customers.rules';
import { type BookingStats, bookingStatsFor } from './customers.service';
import { ListPartnersDto, ReviewPartnerDto, UpdatePartnerDto } from './dto/customers.dto';

export interface PartnerView {
  id: string;
  name: string;
  email: string;
  company: string | null;
  applicationReference: string | null;
  businessType: string | null;
  partnershipCategory: string | null;
  country: string | null;
  city: string | null;
  businessDescription: string | null;
  phone: string | null;
  website: string | null;
  message: string | null;
  applicationStatus: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  roles: string[];
  b2bRole: string | null;
  active: boolean;
  profile: { discountPercent: number; creditTermsDays: number; creditLimitAed: number | null } | null;
  createdAt: Date;
  stats: BookingStats;
}

export interface PartnerResult {
  partner: PartnerView;
  summary: string;
  changes: FieldChange[];
}

const PARTNER_SORTS = ['createdAt', 'firstName', 'email', 'partnerApplication.submittedAt'] as const;
const oid = (id: string) => new Types.ObjectId(id);
const EMPTY: BookingStats = { bookings: 0, confirmed: 0, lifetimeValueAed: 0, otherCurrencyConfirmed: 0, firstBookingAt: null, lastBookingAt: null };

/** B2B partners: users with a partner application or a b2b role. Reuses the users module's application data. */
@Injectable()
export class PartnersAdminService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    private readonly identityCache: UserIdentityCache,
    private readonly staff: StaffDirectoryService,
  ) {}

  async list(query: ListPartnersDto) {
    const filter = this.buildFilter(query);
    const sort = parseSort(query.sort, PARTNER_SORTS, { field: 'partnerApplication.submittedAt', dir: -1 });
    const [rows, total] = await Promise.all([
      this.users.find(filter).select({ internalNotes: 0 }).sort(sort).skip(skipFor(query.page, query.limit)).limit(query.limit).lean<User[]>().exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    const stats = await bookingStatsFor(this.bookings, rows.map((r) => r._id));
    const reviewers = await this.staff.namesFor(rows.flatMap((r) => (r.partnerApplication?.reviewedBy ? [r.partnerApplication.reviewedBy.toString()] : [])));
    return {
      items: rows.map((row) => this.toView(row, stats.get(row._id.toString()), reviewers)),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }

  async *exportRows(query: ListPartnersDto): AsyncGenerator<PartnerView> {
    const cursor = this.users.find(this.buildFilter(query)).sort({ createdAt: -1 }).limit(10_001).lean<User[]>().cursor();
    for await (const row of cursor) yield this.toView(row, undefined, new Map());
  }

  async counts() {
    const grouped = await this.users
      .aggregate<{ _id: string; count: number }>([
        { $match: { partnerApplication: { $ne: null } } },
        { $group: { _id: '$partnerApplication.status', count: { $sum: 1 } } },
      ])
      .exec();
    const get = (status: string) => grouped.find((g) => g._id === status)?.count ?? 0;
    return { pending: get('pending'), approved: get('approved'), rejected: get('rejected') };
  }

  async detail(id: string) {
    const user = await this.find(id);
    const stats = await bookingStatsFor(this.bookings, [user._id]);
    const reviewers = await this.staff.namesFor(user.partnerApplication?.reviewedBy ? [user.partnerApplication.reviewedBy.toString()] : []);
    const recent = await this.bookings
      .find({ customerId: user._id })
      .select({ reference: 1, title: 1, status: 1, total: 1, currency: 1, serviceDate: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean<Booking[]>()
      .exec();
    return {
      ...this.toView(user, stats.get(id), reviewers),
      bookings: recent.map((b) => ({
        id: b._id.toString(),
        reference: b.reference,
        title: b.title,
        status: b.status,
        total: b.total,
        currency: b.currency,
        serviceDate: b.serviceDate ?? null,
        createdAt: b.createdAt,
      })),
    };
  }

  /**
   * Approve (assigns exactly one b2b role and the commercial terms) or reject (reason required).
   * Atomic against the pending state: a second reviewer gets a 409.
   */
  async review(id: string, dto: ReviewPartnerDto, reviewerId: string): Promise<PartnerResult> {
    const before = await this.find(id);
    if (!before.partnerApplication) throw appError(404, 'APPLICATION_NOT_FOUND', 'This person has no partner application');
    if (before.partnerApplication.status !== PartnerApplicationStatus.Pending) {
      throw appError(409, 'ALREADY_REVIEWED', 'This partner application has already been reviewed');
    }
    if (dto.decision === 'reject' && !dto.reason) {
      throw appError(400, 'REASON_REQUIRED', 'A reason is required when rejecting an application');
    }
    const now = new Date();
    const $set: Record<string, unknown> = {
      'partnerApplication.status': dto.decision === 'approve' ? PartnerApplicationStatus.Approved : PartnerApplicationStatus.Rejected,
      'partnerApplication.reviewedAt': now,
      'partnerApplication.reviewedBy': oid(reviewerId),
    };
    if (dto.reason) $set['partnerApplication.reviewNote'] = dto.reason;
    if (dto.decision === 'approve') {
      $set.roles = rolesAfterApproval(before.roles, (dto.role as Role) ?? Role.B2BOwner);
      $set.partnerProfile = {
        discountPercent: dto.discountPercent ?? 0,
        creditTermsDays: dto.creditTermsDays ?? 0,
        ...(dto.creditLimitAed !== undefined ? { creditLimitAed: dto.creditLimitAed } : {}),
      };
    }
    const after = await this.users
      .findOneAndUpdate({ _id: before._id, 'partnerApplication.status': PartnerApplicationStatus.Pending }, { $set }, { returnDocument: 'after' })
      .lean<User>()
      .exec();
    if (!after) throw appError(409, 'ALREADY_REVIEWED', 'This partner application has already been reviewed');
    this.identityCache.invalidate(after.clerkUserId);
    return this.result(
      after,
      `${dto.decision === 'approve' ? 'Approved' : 'Rejected'} partner application of ${after.partnerApplication?.companyName ?? after.email}`,
      { status: before.partnerApplication.status, roles: before.roles },
      { status: after.partnerApplication?.status, roles: after.roles },
    );
  }

  async update(id: string, dto: UpdatePartnerDto): Promise<PartnerResult> {
    if (dto.role === undefined && dto.discountPercent === undefined && dto.creditTermsDays === undefined && dto.creditLimitAed === undefined) {
      throw appError(400, 'NOTHING_TO_UPDATE', 'Provide role, discountPercent, creditTermsDays or creditLimitAed');
    }
    const before = await this.find(id);
    if (before.partnerApplication?.status !== PartnerApplicationStatus.Approved) {
      throw appError(409, 'NOT_APPROVED', 'Only approved partners have commercial terms');
    }
    const $set: Record<string, unknown> = {};
    if (dto.role) $set.roles = rolesAfterApproval(before.roles, dto.role as Role);
    if (dto.discountPercent !== undefined) $set['partnerProfile.discountPercent'] = dto.discountPercent;
    if (dto.creditTermsDays !== undefined) $set['partnerProfile.creditTermsDays'] = dto.creditTermsDays;
    if (dto.creditLimitAed !== undefined) $set['partnerProfile.creditLimitAed'] = dto.creditLimitAed;
    const after = await this.users.findOneAndUpdate({ _id: before._id }, { $set }, { returnDocument: 'after' }).lean<User>().exec();
    this.identityCache.invalidate(after!.clerkUserId);
    return this.result(
      after!,
      `Updated partner terms of ${after!.partnerApplication?.companyName ?? after!.email}`,
      { roles: before.roles, ...(before.partnerProfile ?? {}) },
      { roles: after!.roles, ...(after!.partnerProfile ?? {}) },
    );
  }

  // ------------------------------------------------------------------ internals

  private async find(id: string): Promise<User> {
    const user = await this.users
      .findOne({ _id: oid(id), $or: [{ partnerApplication: { $ne: null } }, { roles: { $in: B2B_ROLES } }] })
      .lean<User>()
      .exec();
    if (!user) throw appError(404, 'PARTNER_NOT_FOUND', 'Partner not found');
    return user;
  }

  private async result(after: User, summary: string, before: Record<string, unknown>, now: Record<string, unknown>): Promise<PartnerResult> {
    const stats = await bookingStatsFor(this.bookings, [after._id]);
    const reviewers = await this.staff.namesFor(after.partnerApplication?.reviewedBy ? [after.partnerApplication.reviewedBy.toString()] : []);
    return { partner: this.toView(after, stats.get(after._id.toString()), reviewers), summary, changes: diffChanges(before, now) };
  }

  private buildFilter(query: ListPartnersDto): Record<string, any> {
    const base: Record<string, any> = { $or: [{ partnerApplication: { $ne: null } }, { roles: { $in: B2B_ROLES } }] };
    const and: Record<string, any>[] = [base];
    if (query.status) and.push({ 'partnerApplication.status': query.status });
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
      and.push({ $or: [{ email: pattern }, { firstName: pattern }, { lastName: pattern }, { 'partnerApplication.companyName': pattern }] });
    }
    return { $and: and };
  }

  private toView(user: User, stats: BookingStats | undefined, reviewers: Map<string, string>): PartnerView {
    const application = user.partnerApplication;
    const reviewedBy = application?.reviewedBy?.toString();
    return {
      id: user._id.toString(),
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
      email: user.email,
      company: application?.companyName ?? null,
      applicationReference: application?.reference ?? null,
      businessType: application?.businessType ?? null,
      partnershipCategory: application?.partnershipCategory ?? null,
      country: application?.country ?? null,
      city: application?.city ?? null,
      businessDescription: application?.businessDescription ?? null,
      phone: application?.phone ?? null,
      website: application?.website ?? null,
      message: application?.message ?? null,
      applicationStatus: application?.status ?? null,
      submittedAt: application?.submittedAt ?? null,
      reviewedAt: application?.reviewedAt ?? null,
      reviewedBy: reviewedBy ? (reviewers.get(reviewedBy) ?? 'Former staff') : null,
      reviewNote: application?.reviewNote ?? null,
      roles: user.roles,
      b2bRole: user.roles.find((r) => (B2B_ROLES as readonly string[]).includes(r)) ?? null,
      active: user.active !== false,
      profile: user.partnerProfile
        ? {
            discountPercent: user.partnerProfile.discountPercent ?? 0,
            creditTermsDays: user.partnerProfile.creditTermsDays ?? 0,
            creditLimitAed: user.partnerProfile.creditLimitAed ?? null,
          }
        : null,
      createdAt: user.createdAt,
      stats: stats ?? EMPTY,
    };
  }
}
