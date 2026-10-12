import { Role } from '../common/enums/role.enum';
import { buildMenu } from './menu';
import {
  ALL_PERMISSIONS,
  hasPermission,
  isStaff,
  permissionsForRoles,
  STAFF_ROLES,
} from './permissions';

describe('permissions map', () => {
  it('gives super_admin every permission', () => {
    expect(permissionsForRoles([Role.SuperAdmin])).toEqual([...ALL_PERMISSIONS]);
  });

  it('gives admin everything except staff.assign_super_admin', () => {
    const admin = permissionsForRoles([Role.Admin]);
    expect(admin).not.toContain('staff.assign_super_admin');
    expect(admin).toContain('staff.assign_roles');
    expect(admin).toHaveLength(ALL_PERMISSIONS.length - 1);
  });

  it.each([[Role.Customer], [Role.B2BOwner], [Role.B2BManager], [Role.B2BAgent]])(
    'gives %s no permissions and no staff status',
    (role) => {
      expect(permissionsForRoles([role])).toEqual([]);
      expect(isStaff([role])).toBe(false);
    },
  );

  it('maps the documented role permissions', () => {
    expect(permissionsForRoles([Role.Sales])).toEqual(
      expect.arrayContaining([
        'dashboard.read',
        'enquiries.read',
        'enquiries.write',
        'enquiries.export',
        'customers.write',
        'bookings.read',
        'partners.read',
        'promos.read',
      ]),
    );
    expect(hasPermission([Role.Sales], 'bookings.write')).toBe(false);
    expect(hasPermission([Role.Operations], 'bookings.cancel')).toBe(true);
    expect(hasPermission([Role.Operations], 'vouchers.validate')).toBe(true);
    expect(hasPermission([Role.Operations], 'bookings.refund')).toBe(false);
    expect(hasPermission([Role.Finance], 'bookings.refund')).toBe(true);
    expect(hasPermission([Role.Finance], 'finance.reconcile')).toBe(true);
    expect(hasPermission([Role.Finance], 'bookings.write')).toBe(false);
    expect(hasPermission([Role.Support], 'tickets.write')).toBe(true);
    expect(hasPermission([Role.Support], 'enquiries.write')).toBe(false);
    expect(hasPermission([Role.Content], 'blog.delete')).toBe(true);
    expect(hasPermission([Role.Content], 'bookings.read')).toBe(false);
  });

  it('maps the stock permissions: operations and admins write, other staff roles read', () => {
    for (const role of [Role.Operations, Role.Admin, Role.SuperAdmin]) {
      expect(hasPermission([role], 'stock.read')).toBe(true);
      expect(hasPermission([role], 'stock.write')).toBe(true);
    }
    for (const role of [Role.Content, Role.Sales, Role.Support, Role.Finance]) {
      expect(hasPermission([role], 'stock.read')).toBe(true);
      expect(hasPermission([role], 'stock.write')).toBe(false);
    }
    for (const role of [Role.Customer, Role.B2BOwner]) expect(permissionsForRoles([role])).not.toContain('stock.read');
  });

  it('maps the purchasing permissions: finance, operations and admins read and write; nobody else', () => {
    for (const role of [Role.Finance, Role.Operations, Role.Admin, Role.SuperAdmin]) {
      expect(hasPermission([role], 'purchasing.read')).toBe(true);
      expect(hasPermission([role], 'purchasing.write')).toBe(true);
    }
    for (const role of [Role.Sales, Role.Support, Role.Content, Role.Customer, Role.B2BOwner]) {
      expect(permissionsForRoles([role])).not.toContain('purchasing.read');
      expect(permissionsForRoles([role])).not.toContain('purchasing.write');
    }
  });

  it('maps the tax permissions: finance and admins read and write, operations read, nobody else', () => {
    for (const role of [Role.Finance, Role.Admin, Role.SuperAdmin]) {
      expect(hasPermission([role], 'tax.read')).toBe(true);
      expect(hasPermission([role], 'tax.write')).toBe(true);
    }
    expect(hasPermission([Role.Operations], 'tax.read')).toBe(true);
    expect(hasPermission([Role.Operations], 'tax.write')).toBe(false);
    for (const role of [Role.Sales, Role.Support, Role.Content, Role.Customer, Role.B2BOwner]) {
      expect(permissionsForRoles([role])).not.toContain('tax.read');
      expect(permissionsForRoles([role])).not.toContain('tax.write');
    }
  });

  it('everyone who can write purchases can also read stock (the line item picker lists stock items)', () => {
    for (const role of STAFF_ROLES) {
      if (hasPermission([role], 'purchasing.write')) expect(hasPermission([role], 'stock.read')).toBe(true);
    }
  });

  it('keeps audit, staff and settings away from non-admin staff roles', () => {
    for (const role of [Role.Sales, Role.Operations, Role.Finance, Role.Support, Role.Content]) {
      for (const permission of permissionsForRoles([role])) {
        expect(permission).not.toMatch(/^(audit|staff|settings)\./);
      }
    }
  });

  it('only grants permissions that exist, and unions multiple roles', () => {
    for (const role of STAFF_ROLES) {
      for (const permission of permissionsForRoles([role])) {
        expect(ALL_PERMISSIONS).toContain(permission);
      }
    }
    const both = permissionsForRoles([Role.Sales, Role.Finance]);
    expect(both).toEqual(expect.arrayContaining(['enquiries.write', 'finance.write']));
  });

  it('ignores unknown roles and client-looking input', () => {
    expect(permissionsForRoles(['root', 'staff.read'])).toEqual([]);
    expect(hasPermission([Role.Customer], 'staff.read')).toBe(false);
  });
});

describe('buildMenu', () => {
  it('adds the Inventory group for stock readers, between catalog and content', () => {
    for (const role of [Role.Operations, Role.Content, Role.Sales, Role.Support, Role.Finance, Role.Admin, Role.SuperAdmin]) {
      const menu = buildMenu(permissionsForRoles([role]));
      const inventory = menu.find((item) => item.id === 'inventory');
      expect(inventory).toMatchObject({ label: 'Inventory', href: '/admin/inventory' });
      expect(inventory?.children).toEqual([
        { id: 'inventory-stock', label: 'Stock', href: '/admin/inventory', icon: 'inventory' },
        { id: 'inventory-alerts', label: 'Low stock & sold out', href: '/admin/inventory/alerts', icon: 'inventory' },
        { id: 'inventory-movements', label: 'Movements', href: '/admin/inventory/movements', icon: 'inventory' },
      ]);
      const ids = menu.map((item) => item.id);
      if (ids.includes('catalog')) expect(ids.indexOf('inventory')).toBeGreaterThan(ids.indexOf('catalog'));
      if (ids.includes('content')) expect(ids.indexOf('inventory')).toBeLessThan(ids.indexOf('content'));
    }
    expect(buildMenu([]).map((item) => item.id)).not.toContain('inventory');
    expect(buildMenu(['bookings.read']).map((item) => item.id)).not.toContain('inventory');
  });

  it('adds the Purchasing group (Purchases, Suppliers) for purchasing readers only', () => {
    for (const role of [Role.Finance, Role.Operations, Role.Admin, Role.SuperAdmin]) {
      const purchasing = buildMenu(permissionsForRoles([role])).find((item) => item.id === 'purchasing');
      expect(purchasing).toMatchObject({ label: 'Purchasing', href: '/admin/purchasing' });
      expect(purchasing?.children).toEqual([
        { id: 'purchasing-purchases', label: 'Purchases', href: '/admin/purchasing', icon: 'purchasing' },
        { id: 'purchasing-suppliers', label: 'Suppliers', href: '/admin/purchasing/suppliers', icon: 'purchasing' },
      ]);
    }
    for (const role of [Role.Sales, Role.Support, Role.Content]) {
      expect(buildMenu(permissionsForRoles([role])).map((item) => item.id)).not.toContain('purchasing');
    }
  });

  it('shows only entries the permissions allow', () => {
    expect(buildMenu([]).map((item) => item.id)).toEqual([]);
    // Other modules append their own entries; assert on what matters for each role.
    const sales = buildMenu(permissionsForRoles([Role.Sales])).map((item) => item.id);
    expect(sales).toContain('dashboard');
    expect(sales).toContain('bookings');
    expect(sales).not.toEqual(expect.arrayContaining(['staff', 'audit', 'settings', 'finance', 'vouchers']));
    const admin = buildMenu(permissionsForRoles([Role.Admin])).map((item) => item.id);
    expect(admin).toEqual(expect.arrayContaining(['dashboard', 'bookings', 'vouchers', 'finance', 'staff', 'audit', 'settings']));
    const ops = buildMenu(permissionsForRoles([Role.Operations]));
    expect(ops.map((item) => item.id)).toEqual(expect.arrayContaining(['bookings', 'vouchers']));
    expect(ops.map((item) => item.id)).not.toContain('finance');
    const finance = buildMenu(permissionsForRoles([Role.Finance]));
    expect(finance.find((item) => item.id === 'finance')?.children?.map((c) => c.id)).toEqual([
      'finance-overview',
      'finance-invoices',
      'finance-reconciliation',
    ]);
  });

  it('lists the catalog group between partners and content for catalog readers', () => {
    for (const role of [Role.Content, Role.Admin, Role.SuperAdmin]) {
      const menu = buildMenu(permissionsForRoles([role]));
      const ids = menu.map((item) => item.id);
      expect(ids).toContain('catalog');
      if (ids.includes('partners')) expect(ids.indexOf('catalog')).toBeGreaterThan(ids.indexOf('partners'));
      expect(ids.indexOf('catalog')).toBeLessThan(ids.indexOf('content'));
      const catalog = menu.find((item) => item.id === 'catalog');
      expect(catalog).toMatchObject({ label: 'Catalog', href: '/admin/catalog', icon: 'catalog' });
      expect(catalog?.children).toEqual([
        { id: 'catalog-activities', label: 'Activities', href: '/admin/catalog/activities', icon: 'activities' },
        { id: 'catalog-media', label: 'Media', href: '/admin/catalog/media', icon: 'catalog' },
        { id: 'catalog-holidays', label: 'Holidays', href: '/admin/catalog/holidays', icon: 'holidays' },
        { id: 'catalog-cruises', label: 'Cruises', href: '/admin/catalog/cruises', icon: 'cruises' },
        { id: 'catalog-events', label: 'Events', href: '/admin/catalog/events', icon: 'events' },
        { id: 'catalog-visas', label: 'Visas', href: '/admin/catalog/visas', icon: 'visas' },
      ]);
    }
    expect(buildMenu([]).map((item) => item.id)).not.toContain('catalog');
  });
});
