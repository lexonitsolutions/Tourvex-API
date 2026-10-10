import type { Permission } from './permissions';

export interface MenuItem {
  id: string;
  label: string;
  href: string;
  /** Icon key the UI maps to its own icon set. */
  icon: string;
  children?: MenuItem[];
}

interface MenuDefinition {
  id: string;
  label: string;
  href: string;
  icon: string;
  /** Visible when the user holds ANY of these permissions. */
  anyOf: Permission[];
  children?: MenuDefinition[];
}

/** Entries only appear for modules that exist; later phases append here. */
const MENU: MenuDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/admin', icon: 'dashboard', anyOf: ['dashboard.read'] },
  {
    id: 'bookings',
    label: 'Bookings',
    href: '/admin/bookings',
    icon: 'bookings',
    anyOf: ['bookings.read'],
    children: [
      { id: 'bookings-all', label: 'All bookings', href: '/admin/bookings', icon: 'bookings', anyOf: ['bookings.read'] },
      { id: 'bookings-orders', label: 'Orders', href: '/admin/bookings/orders', icon: 'bookings', anyOf: ['bookings.read'] },
      { id: 'bookings-cancellations', label: 'Cancellation requests', href: '/admin/bookings/cancellations', icon: 'bookings', anyOf: ['bookings.read'] },
    ],
  },
  {
    id: 'vouchers',
    label: 'Vouchers & Scanner',
    href: '/admin/vouchers',
    icon: 'vouchers',
    anyOf: ['vouchers.read', 'vouchers.validate'],
    children: [
      { id: 'vouchers-list', label: 'Vouchers', href: '/admin/vouchers', icon: 'vouchers', anyOf: ['vouchers.read'] },
      { id: 'vouchers-scan', label: 'Scanner', href: '/admin/scan', icon: 'vouchers', anyOf: ['vouchers.validate'] },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    href: '/admin/finance',
    icon: 'finance',
    anyOf: ['finance.read', 'invoices.read'],
    children: [
      { id: 'finance-overview', label: 'Overview', href: '/admin/finance', icon: 'finance', anyOf: ['finance.read'] },
      { id: 'finance-invoices', label: 'Invoices', href: '/admin/invoices', icon: 'invoices', anyOf: ['invoices.read'] },
      { id: 'finance-reconciliation', label: 'Reconciliation', href: '/admin/finance/reconciliation', icon: 'finance', anyOf: ['finance.reconcile'] },
    ],
  },
  { id: 'reports', label: 'Reports', href: '/admin/reports', icon: 'reports', anyOf: ['dashboard.read'] },
  { id: 'leads', label: 'Leads & Enquiries', href: '/admin/leads', icon: 'leads', anyOf: ['enquiries.read'] },
  { id: 'tickets', label: 'Support Tickets', href: '/admin/tickets', icon: 'tickets', anyOf: ['tickets.read'] },
  { id: 'customers', label: 'Customers', href: '/admin/customers', icon: 'customers', anyOf: ['customers.read'] },
  { id: 'partners', label: 'Partners', href: '/admin/partners', icon: 'partners', anyOf: ['partners.read'] },
  {
    id: 'catalog',
    label: 'Catalog',
    href: '/admin/catalog',
    icon: 'catalog',
    anyOf: ['catalog.read'],
    children: [
      { id: 'catalog-holidays', label: 'Holidays', href: '/admin/catalog/holidays', icon: 'holidays', anyOf: ['catalog.read'] },
      { id: 'catalog-cruises', label: 'Cruises', href: '/admin/catalog/cruises', icon: 'cruises', anyOf: ['catalog.read'] },
      { id: 'catalog-events', label: 'Events', href: '/admin/catalog/events', icon: 'events', anyOf: ['catalog.read'] },
      { id: 'catalog-visas', label: 'Visas', href: '/admin/catalog/visas', icon: 'visas', anyOf: ['catalog.read'] },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    href: '/admin/inventory',
    icon: 'inventory',
    anyOf: ['stock.read'],
    children: [
      { id: 'inventory-stock', label: 'Stock', href: '/admin/inventory', icon: 'inventory', anyOf: ['stock.read'] },
      { id: 'inventory-alerts', label: 'Low stock & sold out', href: '/admin/inventory/alerts', icon: 'inventory', anyOf: ['stock.read'] },
      { id: 'inventory-movements', label: 'Movements', href: '/admin/inventory/movements', icon: 'inventory', anyOf: ['stock.read'] },
    ],
  },
  { id: 'content', label: 'Content', href: '/admin/content', icon: 'content', anyOf: ['cms.read'] },
  { id: 'staff', label: 'Staff', href: '/admin/staff', icon: 'users', anyOf: ['staff.read'] },
  { id: 'audit', label: 'Audit log', href: '/admin/audit', icon: 'shield', anyOf: ['audit.read'] },
  {
    id: 'settings',
    label: 'Settings',
    href: '/admin/settings',
    icon: 'settings',
    anyOf: ['settings.read'],
  },
];

function visible(items: MenuDefinition[], granted: ReadonlySet<string>): MenuItem[] {
  const result: MenuItem[] = [];
  for (const item of items) {
    if (!item.anyOf.some((permission) => granted.has(permission))) continue;
    const entry: MenuItem = { id: item.id, label: item.label, href: item.href, icon: item.icon };
    const children = item.children ? visible(item.children, granted) : [];
    if (children.length) entry.children = children;
    result.push(entry);
  }
  return result;
}

/** The menu the UI renders; built on the server so it never shows what the API would reject. */
export function buildMenu(permissions: readonly string[]): MenuItem[] {
  return visible(MENU, new Set(permissions));
}
