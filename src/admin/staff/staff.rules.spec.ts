import { HttpException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import {
  assertActiveChangeAllowed,
  assertRoleChangeAllowed,
  splitFullName,
  staffRoleDelta,
} from './staff.rules';

const superAdmin = { id: 'sa1', roles: [Role.Customer, Role.SuperAdmin] };
const admin = { id: 'ad1', roles: [Role.Customer, Role.Admin] };

const target = (roles: Role[], extra: Partial<{ id: string; active: boolean }> = {}) => ({
  id: 't1',
  active: true,
  roles,
  ...extra,
});

function codeOf(fn: () => void): { status: number; code: string } | null {
  try {
    fn();
    return null;
  } catch (error) {
    const e = error as HttpException;
    return {
      status: e.getStatus(),
      code: (e.getResponse() as { code: string }).code,
    };
  }
}

describe('assertRoleChangeAllowed', () => {
  const base = { activeSuperAdmins: 2 };

  it('lets an admin assign non-privileged staff roles', () => {
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          ...base,
          actor: admin,
          target: target([Role.Customer, Role.Sales]),
          nextRoles: [Role.Customer, Role.Sales, Role.Support],
        }),
      ),
    ).toBeNull();
  });

  it('only a super_admin may grant admin or super_admin', () => {
    for (const granted of [Role.Admin, Role.SuperAdmin]) {
      expect(
        codeOf(() =>
          assertRoleChangeAllowed({
            ...base,
            actor: admin,
            target: target([Role.Sales]),
            nextRoles: [Role.Sales, granted],
          }),
        ),
      ).toEqual({ status: 403, code: 'SUPER_ADMIN_REQUIRED' });
      expect(
        codeOf(() =>
          assertRoleChangeAllowed({
            ...base,
            actor: superAdmin,
            target: target([Role.Sales]),
            nextRoles: [Role.Sales, granted],
          }),
        ),
      ).toBeNull();
    }
  });

  it('only a super_admin may revoke admin (and an admin cannot touch another admin)', () => {
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          ...base,
          actor: admin,
          target: target([Role.Admin]),
          nextRoles: [Role.Sales],
        }),
      ),
    ).toEqual({ status: 403, code: 'SUPER_ADMIN_REQUIRED' });
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          ...base,
          actor: admin,
          target: target([Role.Admin]),
          nextRoles: [Role.Admin, Role.Sales],
        }),
      ),
    ).toEqual({ status: 403, code: 'SUPER_ADMIN_REQUIRED' });
  });

  it('only a super_admin may create a new admin or super_admin', () => {
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({ ...base, actor: admin, target: null, nextRoles: [Role.Admin] }),
      ),
    ).toEqual({ status: 403, code: 'SUPER_ADMIN_REQUIRED' });
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({ ...base, actor: admin, target: null, nextRoles: [Role.Support] }),
      ),
    ).toBeNull();
  });

  it('staff cannot change their own roles', () => {
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          ...base,
          actor: superAdmin,
          target: target([Role.Customer, Role.SuperAdmin], { id: 'sa1' }),
          nextRoles: [Role.Customer, Role.SuperAdmin, Role.Finance],
        }),
      ),
    ).toEqual({ status: 403, code: 'SELF_ROLE_CHANGE' });
  });

  it('refuses to demote the last active super_admin but allows it with another one left', () => {
    const lastOne = target([Role.SuperAdmin]);
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          actor: superAdmin,
          target: lastOne,
          nextRoles: [Role.Admin],
          activeSuperAdmins: 1,
        }),
      ),
    ).toEqual({ status: 409, code: 'LAST_SUPER_ADMIN' });
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          actor: superAdmin,
          target: lastOne,
          nextRoles: [Role.Admin],
          activeSuperAdmins: 2,
        }),
      ),
    ).toBeNull();
  });

  it('does not count an inactive super_admin as protected', () => {
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          actor: superAdmin,
          target: target([Role.SuperAdmin], { active: false }),
          nextRoles: [Role.Admin],
          activeSuperAdmins: 1,
        }),
      ),
    ).toBeNull();
  });

  it('requires at least one staff role', () => {
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          ...base,
          actor: superAdmin,
          target: target([Role.Sales]),
          nextRoles: [Role.Customer],
        }),
      ),
    ).toEqual({ status: 400, code: 'NO_STAFF_ROLE' });
  });

  it('forbids non-admin staff from assigning roles at all', () => {
    expect(
      codeOf(() =>
        assertRoleChangeAllowed({
          ...base,
          actor: { id: 'x', roles: [Role.Sales] },
          target: target([Role.Support]),
          nextRoles: [Role.Support, Role.Sales],
        }),
      ),
    ).toEqual({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('assertActiveChangeAllowed', () => {
  it('protects the last active super_admin from deactivation', () => {
    expect(
      codeOf(() =>
        assertActiveChangeAllowed({
          actor: superAdmin,
          target: target([Role.SuperAdmin]),
          nextActive: false,
          activeSuperAdmins: 1,
        }),
      ),
    ).toEqual({ status: 409, code: 'LAST_SUPER_ADMIN' });
    expect(
      codeOf(() =>
        assertActiveChangeAllowed({
          actor: superAdmin,
          target: target([Role.SuperAdmin]),
          nextActive: false,
          activeSuperAdmins: 2,
        }),
      ),
    ).toBeNull();
  });

  it('lets only a super_admin deactivate or reactivate an admin', () => {
    expect(
      codeOf(() =>
        assertActiveChangeAllowed({
          actor: admin,
          target: target([Role.Admin]),
          nextActive: false,
          activeSuperAdmins: 2,
        }),
      ),
    ).toEqual({ status: 403, code: 'SUPER_ADMIN_REQUIRED' });
    expect(
      codeOf(() =>
        assertActiveChangeAllowed({
          actor: admin,
          target: target([Role.Admin], { active: false }),
          nextActive: true,
          activeSuperAdmins: 2,
        }),
      ),
    ).toEqual({ status: 403, code: 'SUPER_ADMIN_REQUIRED' });
  });

  it('refuses self-deactivation and ignores no-op changes', () => {
    expect(
      codeOf(() =>
        assertActiveChangeAllowed({
          actor: admin,
          target: target([Role.Sales], { id: 'ad1' }),
          nextActive: false,
          activeSuperAdmins: 2,
        }),
      ),
    ).toEqual({ status: 403, code: 'SELF_DEACTIVATION' });
    expect(
      codeOf(() =>
        assertActiveChangeAllowed({
          actor: admin,
          target: target([Role.SuperAdmin]),
          nextActive: true,
          activeSuperAdmins: 1,
        }),
      ),
    ).toBeNull();
  });
});

describe('helpers', () => {
  it('computes the staff role delta ignoring customer roles', () => {
    expect(
      staffRoleDelta([Role.Customer, Role.Sales], [Role.Customer, Role.Finance]).sort(),
    ).toEqual(['finance', 'sales']);
  });

  it('splits a full name', () => {
    expect(splitFullName('  Ada   Lovelace King ')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace King',
    });
    expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
  });
});
