import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { appError } from '../common/app-error';
import { StockAdminService } from '../stock/stock-admin.service';
import { UsersService } from '../users/users.service';
import { buildMenu, type MenuItem } from './menu';
import { isStaff, permissionsForRoles, STAFF_ROLES } from './permissions';

export interface AdminMe {
  user: { id: string; name: string; email: string; roles: string[] };
  permissions: string[];
  menu: MenuItem[];
}

export interface AdminSummary {
  bookings: { today: number; pending: number };
  enquiries: { open: number };
  tickets: { open: number };
  customers: { new7d: number };
  /** Items running low / sold out over the next 30 days (same figures as GET /admin/stock/summary). */
  stock: { lowStock: number; soldOut: number };
}

const DAY_MS = 86_400_000;

@Injectable()
export class AdminService {
  constructor(
    private readonly users: UsersService,
    private readonly stock: StockAdminService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Roles come from the already-resolved LOCAL user; non-staff get 403. */
  async me(user: { sub: string; roles: string[] }): Promise<AdminMe> {
    if (!isStaff(user.roles)) {
      throw appError(403, 'NOT_STAFF', 'Staff access is required');
    }
    const profile = await this.users.getProfile(user.sub);
    const permissions = permissionsForRoles(user.roles);
    return {
      user: {
        id: profile.id,
        name: [profile.firstName, profile.lastName].filter(Boolean).join(' '),
        email: profile.email,
        roles: profile.roles,
      },
      permissions,
      menu: buildMenu(permissions),
    };
  }

  /** Never fails the dashboard: stock counts fall back to zero. */
  private async stockCounts(now: Date) {
    try {
      const { lowStock, soldOut } = await this.stock.summary(now);
      return { lowStock, soldOut };
    } catch {
      return { lowStock: 0, soldOut: 0 };
    }
  }

  /** Small dashboard counts from existing collections (0 for modules not built yet). */
  async summary(now = new Date()): Promise<AdminSummary> {
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const count = (collection: string, filter: Record<string, unknown>) =>
      this.connection.collection(collection).countDocuments(filter);

    const [today, pending, leads, tickets, customers] = await Promise.all([
      count('bookings', { createdAt: { $gte: startOfDay } }),
      count('bookings', { status: 'pending_payment' }),
      // Leads CRM: every site enquiry becomes a lead; open = still in the pipeline.
      count('leads', { status: { $in: ['new', 'contacted', 'qualified', 'quoted'] } }),
      count('tickets', { status: { $in: ['open', 'pending'] } }),
      count('users', {
        createdAt: { $gte: weekAgo },
        roles: { $in: ['customer'], $nin: STAFF_ROLES },
      }),
    ]);
    return {
      bookings: { today, pending },
      enquiries: { open: leads },
      tickets: { open: tickets },
      customers: { new7d: customers },
      stock: await this.stockCounts(now),
    };
  }
}
