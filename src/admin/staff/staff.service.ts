import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { diffChanges, type FieldChange } from '../../audit/redact';
import { appError } from '../../common/app-error';
import { Role } from '../../common/enums/role.enum';
import {
  buildPagination,
  escapeRegex,
  parseSort,
  skipFor,
} from '../../common/query/paging-query.dto';
import { User, UserStatus } from '../../users/schemas/user.schema';
import { UserIdentityCache } from '../../users/user-identity.cache';
import { STAFF_ROLES } from '../permissions';
import { CreateStaffDto, ListStaffDto, UpdateStaffDto } from './staff.dto';
import {
  assertActiveChangeAllowed,
  assertRoleChangeAllowed,
  type RuleActor,
  splitFullName,
  staffRolesOf,
} from './staff.rules';

export interface StaffView {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  active: boolean;
  status: UserStatus;
  /** True once the person has signed in with Clerk and the account is linked. */
  linkedToClerk: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffResult {
  staff: StaffView;
  summary: string;
  changes: FieldChange[];
}

const STAFF_SORTS = ['createdAt', 'updatedAt', 'email', 'firstName'] as const;

function dedupe(roles: readonly string[]): Role[] {
  return [...new Set(roles)] as Role[];
}

@Injectable()
export class StaffService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly identityCache: UserIdentityCache,
  ) {}

  async list(query: ListStaffDto) {
    const filter: Record<string, any> = {
      roles: query.role ? query.role : { $in: STAFF_ROLES },
    };
    if (query.status === 'active') filter.active = { $ne: false };
    if (query.status === 'inactive') filter.active = false;
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter.$or = [{ email: pattern }, { firstName: pattern }, { lastName: pattern }];
    }
    const sort = parseSort(query.sort, STAFF_SORTS, { field: 'createdAt', dir: -1 });
    const [rows, total] = await Promise.all([
      this.users
        .find(filter)
        .sort(sort)
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<User[]>()
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    return {
      items: rows.map((row) => this.toView(row)),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }

  async get(id: string): Promise<StaffView> {
    return this.toView(await this.findStaff(id));
  }

  /** Creates the local user, or promotes the existing one with that email (same provisioning as customers). */
  async create(dto: CreateStaffDto, actor: RuleActor): Promise<StaffResult> {
    const existing = await this.users.findOne({ email: dto.email }).lean<User>().exec();
    const { firstName, lastName } = splitFullName(dto.fullName);

    if (!existing) {
      assertRoleChangeAllowed({
        actor,
        target: null,
        nextRoles: dto.roles,
        activeSuperAdmins: await this.activeSuperAdmins(),
      });
      const created = await this.users.create({
        firstName,
        lastName,
        email: dto.email,
        roles: dedupe([Role.Customer, ...dto.roles]),
        status: UserStatus.Active,
        active: true,
      });
      const staff = this.toView(created.toObject<User>());
      return {
        staff,
        summary: `Created staff ${staff.email} with roles ${staff.roles.join(', ')}`,
        changes: [
          { field: 'email', from: null, to: staff.email },
          { field: 'fullName', from: null, to: staff.fullName },
          { field: 'roles', from: null, to: staff.roles },
        ],
      };
    }

    // Existing local user (customer, B2B or staff): keep non-staff roles, set the staff roles.
    const nextRoles = dedupe([
      ...existing.roles.filter((role) => !staffRolesOf([role]).length),
      ...dto.roles,
    ]);
    return this.applyUpdate(existing, { fullName: dto.fullName, roles: nextRoles }, actor, 'Added');
  }

  async update(id: string, dto: UpdateStaffDto, actor: RuleActor): Promise<StaffResult> {
    if (dto.fullName === undefined && dto.roles === undefined && dto.active === undefined) {
      throw appError(400, 'NOTHING_TO_UPDATE', 'Provide fullName, roles or active');
    }
    const target = await this.findStaff(id);
    let nextRoles: Role[] | undefined;
    if (dto.roles) {
      nextRoles = dedupe([
        ...target.roles.filter((role) => !staffRolesOf([role]).length),
        ...dto.roles,
      ]);
    }
    return this.applyUpdate(
      target,
      { fullName: dto.fullName, roles: nextRoles, active: dto.active },
      actor,
      'Updated',
    );
  }

  async setActive(id: string, active: boolean, actor: RuleActor): Promise<StaffResult> {
    const target = await this.findStaff(id);
    return this.applyUpdate(target, { active }, actor, active ? 'Reactivated' : 'Deactivated');
  }

  // -------------------------------------------------------------- internals

  private async applyUpdate(
    target: User,
    change: { fullName?: string; roles?: Role[]; active?: boolean },
    actor: RuleActor,
    verb: string,
  ): Promise<StaffResult> {
    const targetId = target._id.toString();
    const ruleTarget = {
      id: targetId,
      roles: target.roles,
      active: target.active !== false,
    };
    const superAdmins = await this.activeSuperAdmins();
    if (change.roles) {
      assertRoleChangeAllowed({
        actor,
        target: ruleTarget,
        nextRoles: change.roles,
        activeSuperAdmins: superAdmins,
      });
    }
    if (change.active !== undefined) {
      assertActiveChangeAllowed({
        actor,
        target: ruleTarget,
        nextActive: change.active,
        activeSuperAdmins: superAdmins,
      });
    }

    const $set: Record<string, unknown> = {};
    if (change.fullName !== undefined) Object.assign($set, splitFullName(change.fullName));
    if (change.roles) $set.roles = change.roles;
    if (change.active !== undefined) $set.active = change.active;

    const updated = await this.users
      .findByIdAndUpdate(target._id, { $set }, { returnDocument: 'after' })
      .lean<User>()
      .exec();
    if (!updated) throw appError(404, 'STAFF_NOT_FOUND', 'Staff member not found');

    // Two concurrent demotions could each pass the check above; verify and undo if none is left.
    const removedSuperAdmin =
      target.roles.includes(Role.SuperAdmin) &&
      ruleTarget.active &&
      (!updated.roles.includes(Role.SuperAdmin) || updated.active === false);
    if (removedSuperAdmin && (await this.activeSuperAdmins()) === 0) {
      await this.users
        .findByIdAndUpdate(target._id, {
          $set: { roles: target.roles, active: ruleTarget.active },
        })
        .exec();
      this.identityCache.invalidate(target.clerkUserId);
      throw appError(409, 'LAST_SUPER_ADMIN', 'The last active super admin cannot be demoted or deactivated');
    }

    this.identityCache.invalidate(updated.clerkUserId);
    const staff = this.toView(updated);
    const before = this.toView(target);
    return {
      staff,
      summary: `${verb} staff ${staff.email}`,
      changes: diffChanges(
        { fullName: before.fullName, roles: before.roles, active: before.active },
        { fullName: staff.fullName, roles: staff.roles, active: staff.active },
      ),
    };
  }

  private async findStaff(id: string): Promise<User> {
    const user = await this.users
      .findOne({ _id: new Types.ObjectId(id), roles: { $in: STAFF_ROLES } })
      .lean<User>()
      .exec();
    if (!user) throw appError(404, 'STAFF_NOT_FOUND', 'Staff member not found');
    return user;
  }

  private activeSuperAdmins(): Promise<number> {
    return this.users
      .countDocuments({ roles: Role.SuperAdmin, status: UserStatus.Active, active: { $ne: false } })
      .exec();
  }

  private toView(user: User): StaffView {
    const lastName = user.lastName ?? '';
    return {
      id: user._id.toString(),
      fullName: `${user.firstName}${lastName ? ` ${lastName}` : ''}`,
      firstName: user.firstName,
      lastName,
      email: user.email,
      roles: user.roles,
      active: user.active !== false,
      status: user.status,
      linkedToClerk: Boolean(user.clerkUserId),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
