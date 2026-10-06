import { formatSequence } from '../common/counters/counters';

/** Pure ticket rules: numbering, status changes, customer permissions and SLA computation. */

export const TICKET_CATEGORIES = ['booking', 'payment', 'refund', 'voucher', 'general', 'complaint'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Statuses where the SLA clock still matters. */
export const ACTIVE_STATUSES: readonly TicketStatus[] = ['open', 'pending'];

export const MESSAGE_MAX_LENGTH = 5000;
/** A customer can reopen a closed ticket for this long after it was closed. */
export const REOPEN_WINDOW_DAYS = 14;
export const MAX_ACTIVE_TICKETS_PER_CUSTOMER = 20;

export function formatTicketNumber(seq: number): string {
  return formatSequence('TKT', seq);
}

/** `TKT-000042` -> 42; anything else -> null. */
export function parseTicketNumber(value: string): number | null {
  const match = /^TKT-(\d{1,12})$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

export interface StatusPlan {
  status: TicketStatus;
  /** What to do with the resolved/closed timestamps. */
  resolvedAt: 'set' | 'clear' | 'keep';
  closedAt: 'set' | 'clear' | 'keep';
}

export type StatusVerdict = { ok: true; plan: StatusPlan } | { ok: false; code: string; message: string };

/** Staff may move a ticket to any other status; the timestamps follow the status. */
export function planStaffStatusChange(from: TicketStatus, to: TicketStatus): StatusVerdict {
  if (from === to) return { ok: false, code: 'NO_CHANGE', message: `The ticket is already ${to}` };
  switch (to) {
    case 'resolved':
      return { ok: true, plan: { status: to, resolvedAt: 'set', closedAt: 'clear' } };
    case 'closed':
      return { ok: true, plan: { status: to, resolvedAt: from === 'resolved' ? 'keep' : 'set', closedAt: 'set' } };
    default:
      return { ok: true, plan: { status: to, resolvedAt: 'clear', closedAt: 'clear' } };
  }
}

/** A customer message on a pending or resolved ticket brings it back to open; closed tickets must be reopened first. */
export function statusAfterCustomerMessage(status: TicketStatus): TicketStatus | null {
  return status === 'closed' ? null : 'open';
}

export function canCustomerClose(status: TicketStatus): boolean {
  return status !== 'closed';
}

export function canCustomerReopen(status: TicketStatus, closedAt: Date | null | undefined, now = new Date()): boolean {
  if (status === 'open' || status === 'pending') return false;
  if (status === 'resolved') return true;
  if (!closedAt) return true;
  return now.getTime() - closedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;
}

export interface SlaTargets {
  firstResponseHours: number;
  resolutionHours: number;
}

export type SlaPhase = 'met' | 'met_late' | 'pending' | 'breached' | 'n/a';

export interface SlaInput {
  createdAt: Date;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  status: TicketStatus;
  targets: SlaTargets;
  now?: Date;
}

export interface SlaView {
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  firstResponse: SlaPhase;
  resolution: SlaPhase;
  /** Either target is breached while the ticket is still active. */
  breached: boolean;
  /** An active deadline is less than an hour away. */
  dueSoon: boolean;
  /** The next deadline that still matters (null once everything is met or the ticket is closed). */
  nextDeadlineAt: Date | null;
}

const HOUR_MS = 3_600_000;

/**
 * SLA clocks run from creation. First response is met by the first public staff reply; resolution
 * by `resolvedAt` (or closing). A ticket that was answered late or resolved late is `met_late` and is
 * not counted as currently breached. The clock does not pause while waiting for the customer.
 */
export function computeSla(input: SlaInput): SlaView {
  const now = input.now ?? new Date();
  const created = input.createdAt.getTime();
  const firstResponseDueAt = new Date(created + input.targets.firstResponseHours * HOUR_MS);
  const resolutionDueAt = new Date(created + input.targets.resolutionHours * HOUR_MS);
  const finished = input.status === 'resolved' || input.status === 'closed';
  const resolvedAt = input.resolvedAt ?? null;

  let firstResponse: SlaPhase;
  if (input.firstResponseAt) {
    firstResponse = input.firstResponseAt.getTime() <= firstResponseDueAt.getTime() ? 'met' : 'met_late';
  } else if (finished) {
    firstResponse = 'n/a';
  } else {
    firstResponse = now.getTime() > firstResponseDueAt.getTime() ? 'breached' : 'pending';
  }

  let resolution: SlaPhase;
  if (finished) {
    resolution = resolvedAt && resolvedAt.getTime() > resolutionDueAt.getTime() ? 'met_late' : 'met';
  } else {
    resolution = now.getTime() > resolutionDueAt.getTime() ? 'breached' : 'pending';
  }

  const breached = firstResponse === 'breached' || resolution === 'breached';
  const deadlines: Date[] = [];
  if (firstResponse === 'pending') deadlines.push(firstResponseDueAt);
  if (resolution === 'pending') deadlines.push(resolutionDueAt);
  const nextDeadlineAt = deadlines.length
    ? new Date(Math.min(...deadlines.map((d) => d.getTime())))
    : null;
  const dueSoon = nextDeadlineAt !== null && nextDeadlineAt.getTime() - now.getTime() < HOUR_MS;
  return { firstResponseDueAt, resolutionDueAt, firstResponse, resolution, breached, dueSoon, nextDeadlineAt };
}

/** Mongo filter for "SLA breached right now" on active tickets, mirroring `computeSla`. */
export function breachedFilter(targets: SlaTargets, now = new Date()): Record<string, unknown> {
  const firstCutoff = new Date(now.getTime() - targets.firstResponseHours * HOUR_MS);
  const resolutionCutoff = new Date(now.getTime() - targets.resolutionHours * HOUR_MS);
  return {
    status: { $in: ACTIVE_STATUSES },
    $or: [
      { firstResponseAt: { $exists: false }, createdAt: { $lt: firstCutoff } },
      { createdAt: { $lt: resolutionCutoff } },
    ],
  };
}
