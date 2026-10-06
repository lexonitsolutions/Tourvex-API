import { appError } from '../../common/app-error';
import { Role } from '../../common/enums/role.enum';
import { hasPermission, isStaffRole, PRIVILEGED_ROLES } from '../permissions';

/**
 * Pure business rules for staff management, kept free of I/O so they are unit tested directly.
 * `activeSuperAdmins` is the number of currently active super_admin users INCLUDING the target.
 */

export interface RuleActor {
  id: string;
  roles: readonly string[];
}

export interface RuleTarget {
  id: string;
  roles: readonly string[];
  active: boolean;
}

const isSuperAdmin = (roles: readonly string[]) => roles.includes(Role.SuperAdmin);
const isPrivileged = (roles: readonly string[]) =>
  roles.some((role) => PRIVILEGED_ROLES.includes(role as Role));

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

export function staffRolesOf(roles: readonly string[]): string[] {
  return roles.filter(isStaffRole);
}

/** Roles added to or removed from the target's staff roles. */
export function staffRoleDelta(current: readonly string[], next: readonly string[]): string[] {
  const before = staffRolesOf(current);
  const after = staffRolesOf(next);
  return [...after.filter((r) => !before.includes(r)), ...before.filter((r) => !after.includes(r))];
}

export function assertRoleChangeAllowed(input: {
  actor: RuleActor;
  /** Null when the record is being created. */
  target: RuleTarget | null;
  nextRoles: readonly string[];
  activeSuperAdmins: number;
}): void {
  const { actor, target, nextRoles, activeSuperAdmins } = input;

  if (staffRolesOf(nextRoles).length === 0) {
    throw appError(400, 'NO_STAFF_ROLE', 'A staff member needs at least one staff role');
  }
  if (!target) {
    // New staff: granting admin/super_admin is super_admin-only.
    if (isPrivileged(nextRoles) && !isSuperAdmin(actor.roles)) {
      throw appError(403, 'SUPER_ADMIN_REQUIRED', 'Only a super admin can grant the admin or super admin role');
    }
    return;
  }

  const changed = !sameSet(target.roles, nextRoles);
  if (!changed) return;

  if (!hasPermission(actor.roles, 'staff.assign_roles')) {
    throw appError(403, 'FORBIDDEN', 'You do not have permission to assign roles');
  }
  if (actor.id === target.id) {
    throw appError(403, 'SELF_ROLE_CHANGE', 'You cannot change your own roles');
  }
  const touchesPrivileged = staffRoleDelta(target.roles, nextRoles).some((role) =>
    PRIVILEGED_ROLES.includes(role as Role),
  );
  if ((touchesPrivileged || isPrivileged(target.roles)) && !isSuperAdmin(actor.roles)) {
    throw appError(
      403,
      'SUPER_ADMIN_REQUIRED',
      'Only a super admin can grant or revoke the admin or super admin role, or change an admin',
    );
  }
  if (
    target.active &&
    isSuperAdmin(target.roles) &&
    !isSuperAdmin(nextRoles) &&
    activeSuperAdmins <= 1
  ) {
    throw appError(409, 'LAST_SUPER_ADMIN', 'The last active super admin cannot be demoted');
  }
}

export function assertActiveChangeAllowed(input: {
  actor: RuleActor;
  target: RuleTarget;
  nextActive: boolean;
  activeSuperAdmins: number;
}): void {
  const { actor, target, nextActive, activeSuperAdmins } = input;
  if (target.active === nextActive) return;
  if (isPrivileged(target.roles) && !isSuperAdmin(actor.roles)) {
    throw appError(403, 'SUPER_ADMIN_REQUIRED', 'Only a super admin can deactivate or reactivate an admin');
  }
  if (!nextActive) {
    if (actor.id === target.id) {
      throw appError(403, 'SELF_DEACTIVATION', 'You cannot deactivate your own account');
    }
    if (isSuperAdmin(target.roles) && activeSuperAdmins <= 1) {
      throw appError(409, 'LAST_SUPER_ADMIN', 'The last active super admin cannot be deactivated');
    }
  }
}

/** `"Ada Lovelace King"` becomes first "Ada", last "Lovelace King". */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}
