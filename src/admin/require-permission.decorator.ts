import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const PERMISSION_KEY = 'requiredPermissions';

/** All listed permissions are required. Enforced by the global PermissionsGuard. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
