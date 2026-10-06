import { Role } from '../common/enums/role.enum';
import { isB2B, isCustomerAccount, lifetimeValue, rolesAfterApproval } from './customers.rules';

describe('customer rules', () => {
  it('treats staff as non-customers and B2B users as customers', () => {
    expect(isCustomerAccount([Role.Customer])).toBe(true);
    expect(isCustomerAccount([Role.Customer, Role.B2BOwner])).toBe(true);
    expect(isCustomerAccount([Role.Customer, Role.Support])).toBe(false);
    expect(isB2B([Role.B2BAgent])).toBe(true);
    expect(isB2B([Role.Customer])).toBe(false);
  });

  it('puts exactly one b2b role on approval and keeps the rest', () => {
    expect(rolesAfterApproval([Role.Customer], Role.B2BOwner)).toEqual([Role.Customer, Role.B2BOwner]);
    expect(rolesAfterApproval([Role.Customer, Role.B2BAgent], Role.B2BManager)).toEqual([Role.Customer, Role.B2BManager]);
    expect(rolesAfterApproval([], Role.B2BOwner)).toEqual([Role.Customer, Role.B2BOwner]);
  });

  it('sums only confirmed AED bookings for lifetime value', () => {
    const result = lifetimeValue([
      { status: 'confirmed', currency: 'AED', total: 100.1 },
      { status: 'confirmed', currency: 'aed', total: 50.2 },
      { status: 'cancelled', currency: 'AED', total: 999 },
      { status: 'pending_payment', currency: 'AED', total: 500 },
      { status: 'confirmed', currency: 'USD', total: 300 },
      { status: 'refunded', currency: 'AED', total: 70 },
    ]);
    expect(result).toEqual({ bookings: 6, confirmed: 3, lifetimeValueAed: 150.3, otherCurrencyConfirmed: 1 });
  });

  it('is zero for no bookings', () => {
    expect(lifetimeValue([])).toEqual({ bookings: 0, confirmed: 0, lifetimeValueAed: 0, otherCurrencyConfirmed: 0 });
  });
});
