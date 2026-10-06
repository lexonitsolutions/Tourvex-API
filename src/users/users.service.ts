import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { User as ClerkUser } from '@clerk/backend';
import { Model, Types } from 'mongoose';
import { ClerkService } from '../clerk/clerk.service';
import { assertRoleChangeAllowed, staffRolesOf, type RuleActor } from '../admin/staff/staff.rules';
import { appError } from '../common/app-error';
import { Role } from '../common/enums/role.enum';
import { CreatePartnerApplicationDto } from './dto/create-partner-application.dto';
import { ReviewPartnerApplicationDto } from './dto/review-partner-application.dto';
import { PartnerApplicationStatus, User, UserStatus } from './schemas/user.schema';
import { ResolvedIdentity, UserIdentityCache } from './user-identity.cache';

export interface PartnerApplicationView {
  status: PartnerApplicationStatus;
  companyName: string;
  phone?: string;
  website?: string;
  message?: string;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNote?: string;
}

/** Shape returned by `GET /auth/me` and the partner-application submission. */
export interface UserProfile {
  id: string;
  clerkUserId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  roles: Role[];
  status: UserStatus;
  partnerApplication: PartnerApplicationView | null;
}

const MAX_PROVISION_ATTEMPTS = 3;

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly clerk: ClerkService,
    private readonly identityCache: UserIdentityCache,
  ) {}

  /**
   * Maps a verified Clerk user id to the local user, provisioning or linking it on first sight.
   * Results are cached briefly; see UserIdentityCache.
   */
  async resolveFromClerk(clerkUserId: string): Promise<ResolvedIdentity> {
    const cached = this.identityCache.get(clerkUserId);
    if (cached) return cached;

    const user =
      (await this.users.findOne({ clerkUserId }).lean<User>().exec()) ??
      (await this.provisionFromClerk(clerkUserId));
    const identity: ResolvedIdentity = {
      id: user._id.toString(),
      clerkUserId,
      email: user.email,
      roles: user.roles,
      status: user.status,
      active: user.active !== false,
      partnerId: user.partnerId?.toString(),
    };
    this.identityCache.set(identity);
    return identity;
  }

  async getProfile(id: string): Promise<UserProfile> {
    const user = await this.users.findById(id).lean<User>().exec();
    if (!user) throw new NotFoundException('User not found');
    return this.toProfile(user);
  }

  async list() {
    return this.users.find().sort({ createdAt: -1 }).lean().exec();
  }

  async updateStatus(id: string, status: UserStatus) {
    const user = await this.users
      .findByIdAndUpdate(id, { $set: { status } }, { returnDocument: 'after' })
      .exec();
    if (!user) throw new NotFoundException('User not found');
    this.identityCache.invalidate(user.clerkUserId);
    return user;
  }

  async updateRoles(id: string, roles: Role[]) {
    const user = await this.users
      .findByIdAndUpdate(id, { $set: { roles } }, { returnDocument: 'after' })
      .exec();
    if (!user) throw new NotFoundException('User not found');
    this.identityCache.invalidate(user.clerkUserId);
    return user;
  }

  private activeSuperAdmins(): Promise<number> {
    return this.users
      .countDocuments({ roles: Role.SuperAdmin, active: { $ne: false }, status: UserStatus.Active })
      .exec();
  }

  /**
   * Legacy PATCH /users/:id/roles, now bound by the same rules as /admin/staff: nobody changes their
   * own roles, only a super admin touches admin/super_admin, and the last active super admin stays.
   * Returns the updated user plus the before/after for the audit entry.
   */
  async updateRolesAs(actor: RuleActor, id: string, roles: Role[]) {
    const target = await this.users.findById(id).lean<User>().exec();
    if (!target) throw new NotFoundException('User not found');
    const next = [...new Set(roles)];
    const same = target.roles.length === next.length && target.roles.every((r) => next.includes(r));
    if (!same) {
      const targetFacts = { id, roles: target.roles, active: target.active !== false };
      const superAdmins = await this.activeSuperAdmins();
      if (staffRolesOf(next).length > 0) {
        assertRoleChangeAllowed({ actor, target: targetFacts, nextRoles: next, activeSuperAdmins: superAdmins });
      } else if (staffRolesOf(target.roles).length > 0) {
        // Removing every staff role is a deactivation-grade change: same guards as a role edit.
        if (actor.id === id) throw appError(403, 'SELF_ROLE_CHANGE', 'You cannot change your own roles');
        if (target.roles.some((r) => r === Role.Admin || r === Role.SuperAdmin) && !actor.roles.includes(Role.SuperAdmin)) {
          throw appError(403, 'SUPER_ADMIN_REQUIRED', 'Only a super admin can change an admin');
        }
        if (target.roles.includes(Role.SuperAdmin) && superAdmins <= 1) {
          throw appError(409, 'LAST_SUPER_ADMIN', 'The last active super admin cannot be demoted');
        }
      } else if (actor.id === id) {
        throw appError(403, 'SELF_ROLE_CHANGE', 'You cannot change your own roles');
      }
    }
    const user = await this.updateRoles(id, next);
    return { user, before: target.roles, after: next };
  }

  /** Legacy PATCH /users/:id/status with the self/admin/last-super-admin guards of the staff rules. */
  async updateStatusAs(actor: RuleActor, id: string, status: UserStatus) {
    const target = await this.users.findById(id).lean<User>().exec();
    if (!target) throw new NotFoundException('User not found');
    if (target.status !== status) {
      if (actor.id === id) throw appError(403, 'SELF_STATUS_CHANGE', 'You cannot change your own account status');
      const privileged = target.roles.some((r) => r === Role.Admin || r === Role.SuperAdmin);
      if (privileged && !actor.roles.includes(Role.SuperAdmin)) {
        throw appError(403, 'SUPER_ADMIN_REQUIRED', 'Only a super admin can change the status of an admin');
      }
      if (status !== UserStatus.Active && target.roles.includes(Role.SuperAdmin) && (await this.activeSuperAdmins()) <= 1) {
        throw appError(409, 'LAST_SUPER_ADMIN', 'The last active super admin cannot be suspended');
      }
    }
    const user = await this.updateStatus(id, status);
    return { user, before: target.status, after: status };
  }

  /** A signed-in user applies to become a B2B partner. Rejected applicants may re-apply. */
  async submitPartnerApplication(
    userId: string,
    dto: CreatePartnerApplicationDto,
  ): Promise<UserProfile> {
    const application = {
      status: PartnerApplicationStatus.Pending,
      companyName: dto.companyName,
      submittedAt: new Date(),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.website !== undefined && { website: dto.website }),
      ...(dto.message !== undefined && { message: dto.message }),
    };
    // Atomic guard against double submission: only replace a missing or rejected application.
    const updated = await this.users
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(userId),
          $or: [
            { partnerApplication: null },
            { 'partnerApplication.status': PartnerApplicationStatus.Rejected },
          ],
        },
        { $set: { partnerApplication: application } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<User>()
      .exec();
    if (updated) return this.toProfile(updated);

    if (!(await this.users.exists({ _id: new Types.ObjectId(userId) }))) {
      throw new NotFoundException('User not found');
    }
    throw new ConflictException('A partner application is already pending or approved');
  }

  /** An administrator approves or rejects a pending partner application. */
  async reviewPartnerApplication(id: string, dto: ReviewPartnerApplicationDto, reviewerId: string) {
    const set: Record<string, unknown> = {
      'partnerApplication.status': dto.decision,
      'partnerApplication.reviewedAt': new Date(),
      'partnerApplication.reviewedBy': new Types.ObjectId(reviewerId),
    };
    if (dto.note !== undefined) set['partnerApplication.reviewNote'] = dto.note;
    const approved = dto.decision === PartnerApplicationStatus.Approved;

    const updated = await this.users
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          'partnerApplication.status': PartnerApplicationStatus.Pending,
        },
        approved ? { $set: set, $addToSet: { roles: Role.B2BOwner } } : { $set: set },
        { returnDocument: 'after' },
      )
      .lean<User>()
      .exec();
    if (updated) {
      this.identityCache.invalidate(updated.clerkUserId);
      return updated;
    }

    const current = await this.users
      .findById(id)
      .select('partnerApplication')
      .lean<Pick<User, '_id' | 'partnerApplication'>>()
      .exec();
    if (!current?.partnerApplication) throw new NotFoundException('Partner application not found');
    throw new ConflictException('This partner application has already been reviewed');
  }

  toProfile(user: User): UserProfile {
    const application = user.partnerApplication;
    return {
      id: user._id.toString(),
      clerkUserId: user.clerkUserId ?? null,
      firstName: user.firstName,
      lastName: user.lastName ?? '',
      email: user.email,
      roles: user.roles,
      status: user.status,
      partnerApplication: application
        ? {
            status: application.status,
            companyName: application.companyName,
            phone: application.phone,
            website: application.website,
            message: application.message,
            submittedAt: application.submittedAt,
            reviewedAt: application.reviewedAt,
            reviewedBy: application.reviewedBy?.toString(),
            reviewNote: application.reviewNote,
          }
        : null,
    };
  }

  /**
   * Just-in-time provisioning for a Clerk user we have not seen before.
   * - Verified primary email matching a local user: link (keeps that user's roles).
   * - Unverified primary email matching a local user: refuse (prevents account takeover).
   * - No local user with that email: create an active customer.
   * Concurrent first requests are resolved by the unique indexes plus a re-read/retry.
   */
  private async provisionFromClerk(clerkUserId: string): Promise<User> {
    const clerkUser = await this.fetchClerkUser(clerkUserId);
    const primary = clerkUser.emailAddresses.find(
      (address) => address.id === clerkUser.primaryEmailAddressId,
    );
    if (!primary?.emailAddress) {
      throw new ForbiddenException('A verified email address is required');
    }
    const email = primary.emailAddress.trim().toLowerCase();
    const verified = primary.verification?.status === 'verified';

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.linkOrCreate(clerkUserId, email, verified, clerkUser);
      } catch (error) {
        if (!isDuplicateKeyError(error) || attempt >= MAX_PROVISION_ATTEMPTS) throw error;
        const raced = await this.users.findOne({ clerkUserId }).lean<User>().exec();
        if (raced) return raced;
      }
    }
  }

  private async linkOrCreate(
    clerkUserId: string,
    email: string,
    verified: boolean,
    clerkUser: ClerkUser,
  ): Promise<User> {
    const existing = await this.users.findOne({ email }).lean<User>().exec();
    if (existing) {
      if (!verified) {
        throw new ForbiddenException(
          'Verify your email address to access an existing account with this email',
        );
      }
      if (existing.clerkUserId && existing.clerkUserId !== clerkUserId) {
        // Same verified email, new Clerk identity (e.g. Clerk user re-created or instance changed).
        this.logger.warn(`Re-linking local user ${existing._id.toString()} to a new Clerk user`);
        this.identityCache.invalidate(existing.clerkUserId);
      }
      const linked = await this.users
        .findByIdAndUpdate(existing._id, { $set: { clerkUserId } }, { returnDocument: 'after' })
        .lean<User>()
        .exec();
      if (!linked) throw new UnauthorizedException('Authentication required');
      return linked;
    }

    const created = await this.users.create({
      firstName: clerkUser.firstName?.trim() || email.split('@')[0],
      lastName: clerkUser.lastName?.trim() || '',
      email,
      clerkUserId,
      roles: [Role.Customer],
      status: UserStatus.Active,
    });
    return created.toObject<User>();
  }

  private async fetchClerkUser(clerkUserId: string): Promise<ClerkUser> {
    try {
      return await this.clerk.client.users.getUser(clerkUserId);
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 404) throw new UnauthorizedException('Authentication required');
      this.logger.error(`Clerk user lookup failed (status ${status ?? 'unknown'})`);
      throw new ServiceUnavailableException('Authentication is temporarily unavailable');
    }
  }
}
