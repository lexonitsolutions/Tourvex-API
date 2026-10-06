import { Role } from '../common/enums/role.enum';
import { STAFF_ROLES } from '../admin/permissions';

export const B2B_ROLES: readonly Role[] = [Role.B2BOwner, Role.B2BManager, Role.B2BAgent];

export function isB2B(roles: readonly string[]): boolean {
  return roles.some((role) => (B2B_ROLES as readonly string[]).includes(role));
}

/** Customers are every user that is not staff (B2B users included, flagged by role). */
export function isCustomerAccount(roles: readonly string[]): boolean {
  return !roles.some((role) => (STAFF_ROLES as readonly string[]).includes(role));
}

/** Approval puts exactly one b2b role on the person and keeps every other role (customer, ...). */
export function rolesAfterApproval(current: readonly string[], role: Role): Role[] {
  const kept = current.filter((r) => !(B2B_ROLES as readonly string[]).includes(r)) as Role[];
  return [...new Set([...kept, Role.Customer, role])];
}

export interface BookingTotals {
  status: string;
  currency: string;
  total: number;
}

/**
 * Lifetime value in AED: the sum of CONFIRMED bookings charged in AED. Confirmed bookings in any
 * other currency are counted separately instead of being converted with a guessed rate.
 */
export function lifetimeValue(rows: readonly BookingTotals[]) {
  let lifetimeValueAed = 0;
  let confirmed = 0;
  let otherCurrencyConfirmed = 0;
  for (const row of rows) {
    if (row.status !== 'confirmed') continue;
    confirmed += 1;
    if ((row.currency ?? '').toUpperCase() === 'AED') lifetimeValueAed += row.total;
    else otherCurrencyConfirmed += 1;
  }
  return {
    bookings: rows.length,
    confirmed,
    lifetimeValueAed: Math.round(lifetimeValueAed * 100) / 100,
    otherCurrencyConfirmed,
  };
}
