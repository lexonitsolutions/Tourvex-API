import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserStatus } from '../../users/schemas/user.schema';
import { type Permission, permissionsForRoles, STAFF_ROLES } from '../permissions';

export interface StaffRef {
  id: string;
  name: string;
  email: string;
}

const fullName = (user: Pick<User, 'firstName' | 'lastName' | 'email'>) =>
  [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

/**
 * Who can be assigned work: active staff whose roles grant a given permission. Used by the leads
 * and tickets owner/assignee selects so a sales or support person does not need `staff.read`.
 */
@Injectable()
export class StaffDirectoryService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async assignable(permission: Permission): Promise<StaffRef[]> {
    const rows = await this.users
      .find({ roles: { $in: STAFF_ROLES }, status: UserStatus.Active, active: { $ne: false } })
      .select({ firstName: 1, lastName: 1, email: 1, roles: 1 })
      .sort({ firstName: 1, email: 1 })
      .limit(500)
      .lean<User[]>()
      .exec();
    return rows
      .filter((row) => permissionsForRoles(row.roles).includes(permission))
      .map((row) => ({ id: row._id.toString(), name: fullName(row), email: row.email }));
  }

  /** The assignable person, or null when the id is not an active staff member holding the permission. */
  async findAssignable(id: string, permission: Permission): Promise<StaffRef | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const row = await this.users
      .findOne({
        _id: new Types.ObjectId(id),
        roles: { $in: STAFF_ROLES },
        status: UserStatus.Active,
        active: { $ne: false },
      })
      .select({ firstName: 1, lastName: 1, email: 1, roles: 1 })
      .lean<User>()
      .exec();
    if (!row || !permissionsForRoles(row.roles).includes(permission)) return null;
    return { id: row._id.toString(), name: fullName(row), email: row.email };
  }

  /** Display names for a set of staff ids (owner avatars in lists). */
  async namesFor(ids: readonly string[]): Promise<Map<string, string>> {
    const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (!valid.length) return new Map();
    const rows = await this.users
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) } })
      .select({ firstName: 1, lastName: 1, email: 1 })
      .lean<User[]>()
      .exec();
    return new Map(rows.map((row) => [row._id.toString(), fullName(row)]));
  }
}
