import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../common/enums/role.enum';
import { PermissionsGuard } from './permissions.guard';
import type { Permission } from './permissions';

function contextFor(user: { roles: string[] } | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PermissionsGuard(reflector as unknown as Reflector);
  });

  const require = (...permissions: Permission[]) =>
    reflector.getAllAndOverride.mockReturnValue(permissions);

  it('passes routes without @RequirePermission (existing @Roles routes are untouched)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextFor({ roles: [Role.Customer] }))).toBe(true);
    reflector.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('allows a role that holds the permission', () => {
    require('bookings.read');
    expect(guard.canActivate(contextFor({ roles: [Role.Operations] }))).toBe(true);
  });

  it('answers 403 with a stable code for a role without it', () => {
    require('bookings.write');
    try {
      guard.canActivate(contextFor({ roles: [Role.Sales] }));
      throw new Error('expected a 403');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
      expect((error as HttpException).getResponse()).toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });
    }
  });

  it('denies customers, users without roles and missing users', () => {
    require('dashboard.read');
    expect(() => guard.canActivate(contextFor({ roles: [Role.Customer] }))).toThrow(HttpException);
    expect(() => guard.canActivate(contextFor({ roles: [] }))).toThrow(HttpException);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(HttpException);
  });

  it('requires ALL listed permissions', () => {
    require('bookings.read', 'finance.read');
    expect(() => guard.canActivate(contextFor({ roles: [Role.Sales] }))).toThrow(HttpException);
    expect(guard.canActivate(contextFor({ roles: [Role.Finance] }))).toBe(true);
  });

  it('never trusts permissions supplied by the client', () => {
    require('staff.read');
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          user: { roles: [Role.Customer] },
          headers: { 'x-permissions': 'staff.read' },
          body: { permissions: ['staff.read'] },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });
});
