import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { appError } from '../common/app-error';
import { PERMISSION_KEY } from './require-permission.decorator';
import { hasPermission, type Permission } from './permissions';

/**
 * Global guard (runs after ClerkAuthGuard). Routes without @RequirePermission pass through, so
 * existing @Roles() routes are unaffected. Permissions are derived from the roles the auth guard
 * resolved from the LOCAL user, never from the request.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<{ user?: { roles?: string[] } }>();
    const roles = request.user?.roles ?? [];
    if (required.every((permission) => hasPermission(roles, permission))) return true;
    throw appError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
  }
}
