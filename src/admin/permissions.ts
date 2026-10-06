import { Role } from '../common/enums/role.enum';

/**
 * The ONE place that maps roles to permissions (`<module>.<action>`). Permissions are never
 * accepted from the client; the guard and `GET /admin/me` both derive them from the local user's
 * roles through this file.
 */

export const PERMISSION_MODULES = [
  'dashboard',
  'bookings',
  'enquiries',
  'tickets',
  'vouchers',
  'customers',
  'partners',
  'catalog',
  'blog',
  'promos',
  'reviews',
  'finance',
  'invoices',
  'integrations',
  'settings',
  'staff',
  'audit',
  'cms',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

/** Every permission that exists. A role can only be granted permissions from this list. */
export const ALL_PERMISSIONS = [
  'dashboard.read',
  'bookings.read',
  'bookings.write',
  'bookings.cancel',
  'bookings.refund',
  'bookings.export',
  'enquiries.read',
  'enquiries.write',
  'enquiries.delete',
  'enquiries.export',
  'tickets.read',
  'tickets.write',
  'tickets.delete',
  'tickets.export',
  'vouchers.read',
  'vouchers.write',
  'vouchers.delete',
  'vouchers.export',
  'vouchers.validate',
  'customers.read',
  'customers.write',
  'customers.delete',
  'customers.export',
  'partners.read',
  'partners.write',
  'partners.delete',
  'partners.export',
  'catalog.read',
  'catalog.write',
  'catalog.delete',
  'catalog.export',
  'blog.read',
  'blog.write',
  'blog.delete',
  'promos.read',
  'promos.write',
  'promos.delete',
  'reviews.read',
  'reviews.write',
  'reviews.delete',
  'finance.read',
  'finance.write',
  'finance.export',
  'finance.reconcile',
  'invoices.read',
  'invoices.write',
  'invoices.delete',
  'invoices.export',
  'integrations.read',
  'integrations.write',
  'settings.read',
  'settings.write',
  'staff.read',
  'staff.write',
  'staff.assign_roles',
  'staff.assign_super_admin',
  'audit.read',
  'cms.read',
  'cms.write',
  'cms.publish',
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

/** Roles that identify a person as staff (anyone else is a customer or B2B user). */
export const STAFF_ROLES: readonly Role[] = [
  Role.Content,
  Role.Sales,
  Role.Operations,
  Role.Finance,
  Role.Support,
  Role.Admin,
  Role.SuperAdmin,
];

/** Granting or revoking these is reserved to super_admin. */
export const PRIVILEGED_ROLES: readonly Role[] = [Role.Admin, Role.SuperAdmin];

const all = (module: PermissionModule): Permission[] =>
  ALL_PERMISSIONS.filter((permission) => permission.startsWith(`${module}.`));

const ROLE_PERMISSIONS: Partial<Record<Role, readonly Permission[]>> = {
  [Role.SuperAdmin]: ALL_PERMISSIONS,
  // Everything except the super_admin grant permission.
  [Role.Admin]: ALL_PERMISSIONS.filter((permission) => permission !== 'staff.assign_super_admin'),
  [Role.Sales]: [
    'dashboard.read',
    ...all('enquiries'),
    'customers.read',
    'customers.write',
    'bookings.read',
    'partners.read',
    'promos.read',
  ],
  [Role.Operations]: [
    'bookings.read',
    'bookings.write',
    'bookings.cancel',
    'bookings.export',
    ...all('vouchers'),
    'catalog.read',
    'enquiries.read',
  ],
  [Role.Finance]: [
    'bookings.read',
    ...all('finance'),
    ...all('invoices'),
    'bookings.refund',
    'bookings.export',
    'dashboard.read',
    'customers.read',
  ],
  [Role.Support]: [
    ...all('tickets'),
    'bookings.read',
    'customers.read',
    ...all('reviews'),
    'enquiries.read',
  ],
  [Role.Content]: [
    ...all('catalog'),
    ...all('blog'),
    ...all('promos'),
    ...all('reviews'),
    ...all('cms'),
    'dashboard.read',
  ],
};

/** Union of the permissions of every given role; unknown roles (customer, b2b_*) grant nothing. */
export function permissionsForRoles(roles: readonly string[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role as Role] ?? []) granted.add(permission);
  }
  return ALL_PERMISSIONS.filter((permission) => granted.has(permission));
}

export function hasPermission(roles: readonly string[], permission: string): boolean {
  return permissionsForRoles(roles).includes(permission as Permission);
}

export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.includes(role as Role);
}

export function isStaff(roles: readonly string[]): boolean {
  return roles.some(isStaffRole);
}
