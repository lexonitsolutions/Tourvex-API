/**
 * Pure lead rules: pipeline transitions, follow-up state, dedupe keys and the mapping from the
 * existing enquiry collections (and the contact form) to the unified lead shape. No I/O, so it is
 * unit tested and shared by the live capture path and the `leads:backfill` script.
 */

export const LEAD_SOURCES = ['activity', 'holiday', 'visa', 'cruise', 'event', 'contact', 'b2b'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'quoted', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const OPEN_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'qualified', 'quoted'];

export const LEAD_PRIORITIES = ['low', 'normal', 'high'] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LOST_REASONS = [
  'price',
  'no_response',
  'competitor',
  'changed_plans',
  'not_qualified',
  'duplicate',
  'spam',
  'other',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const CONTACT_CHANNELS = ['email', 'phone', 'whatsapp'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CATALOG_TYPES = ['activity', 'holiday', 'visa', 'cruise', 'event'] as const;
export type CatalogType = (typeof CATALOG_TYPES)[number];

export type TransitionResult = { ok: true } | { ok: false; code: string; message: string };

/**
 * Pipeline rules:
 * - open statuses (new, contacted, qualified, quoted) can move freely to another open status,
 *   except back to `new` (that means "untouched");
 * - `won` needs the lead to have been worked first (not straight from `new`);
 * - `lost` is allowed from any open status and needs a reason;
 * - a closed lead (won/lost) can only be reopened, which puts it back to `contacted`.
 */
export function evaluateTransition(
  from: LeadStatus,
  to: LeadStatus,
  lostReason?: string | null,
): TransitionResult {
  if (from === to) return { ok: false, code: 'NO_CHANGE', message: `The lead is already ${to}` };
  const closed = from === 'won' || from === 'lost';
  if (closed) {
    return to === 'contacted'
      ? { ok: true }
      : {
          ok: false,
          code: 'LEAD_CLOSED',
          message: 'A won or lost lead can only be reopened (moved back to contacted)',
        };
  }
  if (to === 'new') {
    return { ok: false, code: 'INVALID_TRANSITION', message: 'A lead cannot move back to new' };
  }
  if (to === 'lost') {
    return lostReason && (LOST_REASONS as readonly string[]).includes(lostReason)
      ? { ok: true }
      : { ok: false, code: 'LOST_REASON_REQUIRED', message: 'A lost reason is required' };
  }
  if (to === 'won' && from === 'new') {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: 'Contact the lead before marking it won',
    };
  }
  return { ok: true };
}

/** Dubai has no DST (UTC+4), so day boundaries are a fixed offset. */
const DUBAI_OFFSET_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

export function dubaiDayBounds(now: Date): { start: Date; end: Date } {
  const shifted = now.getTime() + DUBAI_OFFSET_MS;
  const startShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  const start = new Date(startShifted - DUBAI_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export type FollowUpState = 'none' | 'overdue' | 'today' | 'upcoming';

/** Closed leads never nag. `overdue` = the scheduled time has passed; `today` = later today (Dubai). */
export function followUpState(
  nextFollowUpAt: Date | null | undefined,
  status: LeadStatus,
  now = new Date(),
): FollowUpState {
  if (!nextFollowUpAt || !OPEN_STATUSES.includes(status)) return 'none';
  if (nextFollowUpAt.getTime() < now.getTime()) return 'overdue';
  return nextFollowUpAt.getTime() < dubaiDayBounds(now).end.getTime() ? 'today' : 'upcoming';
}

/** Idempotency key: one lead per (source, sourceRef). */
export function dedupeKey(source: string, sourceRef: string): string {
  return `${source}:${sourceRef.trim().toUpperCase()}`;
}

/** Digits (and a leading +) only, for tel: and WhatsApp links and loose matching. */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function humanizeSlug(slug: string): string {
  const text = slug.replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

export interface LeadSeed {
  source: LeadSource;
  sourceRef: string;
  /** Id of the originating enquiry document (when there is one). */
  sourceId?: string;
  catalog?: { type: CatalogType; slug: string; id?: string; title?: string };
  name: string;
  email: string;
  phone?: string;
  nationality?: string;
  message?: string;
  subject?: string;
  pax?: number;
  adults?: number;
  children?: number;
  travelDate?: Date;
  valueAed?: number;
  marketingOptOut?: boolean;
  consentAt: Date;
  userId?: string;
  createdAt?: Date;
  /** Status carried over from a legacy enquiry (backfill only). */
  legacyStatus?: string;
  legacyNote?: string;
}

type Id = { toString(): string };
interface BaseEnquiry {
  _id: Id;
  reference: string;
  fullName: string;
  email: string;
  phone?: string;
  message?: string;
  consentAt: Date;
  userId?: Id | null;
  status?: string;
  note?: string;
  createdAt?: Date;
}

const base = (e: BaseEnquiry) => ({
  sourceRef: e.reference,
  sourceId: e._id.toString(),
  name: e.fullName,
  email: e.email,
  phone: e.phone,
  message: e.message,
  consentAt: e.consentAt,
  userId: e.userId ? e.userId.toString() : undefined,
  createdAt: e.createdAt,
  legacyStatus: e.status,
  legacyNote: e.note,
});

export function fromVisaEnquiry(
  e: BaseEnquiry & {
    visaId?: Id;
    visaSlug: string;
    nationality?: string;
    travellers: number;
    travelDate?: Date;
  },
): LeadSeed {
  return {
    ...base(e),
    source: 'visa',
    catalog: { type: 'visa', slug: e.visaSlug, id: e.visaId?.toString(), title: humanizeSlug(e.visaSlug) },
    nationality: e.nationality,
    pax: e.travellers,
    travelDate: e.travelDate,
  };
}

export function fromCruiseEnquiry(
  e: BaseEnquiry & {
    cruiseId?: Id;
    cruiseSlug: string;
    nationality?: string;
    adults: number;
    children: number;
    departureDate?: Date;
    cabinType?: string;
  },
): LeadSeed {
  return {
    ...base(e),
    source: 'cruise',
    catalog: { type: 'cruise', slug: e.cruiseSlug, id: e.cruiseId?.toString(), title: humanizeSlug(e.cruiseSlug) },
    nationality: e.nationality,
    pax: e.adults + e.children,
    adults: e.adults,
    children: e.children,
    travelDate: e.departureDate,
    subject: e.cabinType ? `Cabin: ${e.cabinType}` : undefined,
  };
}

export function fromEventEnquiry(
  e: BaseEnquiry & { eventId?: Id; eventSlug: string; tickets: number; ticketType?: string },
): LeadSeed {
  return {
    ...base(e),
    source: 'event',
    catalog: { type: 'event', slug: e.eventSlug, id: e.eventId?.toString(), title: humanizeSlug(e.eventSlug) },
    pax: e.tickets,
    subject: e.ticketType ? `Ticket type: ${e.ticketType}` : undefined,
  };
}

export function fromHolidayEnquiry(
  e: BaseEnquiry & {
    holidayId?: Id;
    holidaySlug: string;
    travelers?: number;
    travelDate?: Date;
    totalAmount?: number | null;
    currency?: string;
    nationality?: string;
    adults?: number;
    children?: number;
    marketingOptOut?: boolean;
  },
): LeadSeed {
  const inAed =
    (e.currency ?? 'AED').toUpperCase() === 'AED' &&
    typeof e.totalAmount === 'number' &&
    e.totalAmount > 0;
  return {
    ...base(e),
    source: 'holiday',
    catalog: { type: 'holiday', slug: e.holidaySlug, id: e.holidayId?.toString(), title: humanizeSlug(e.holidaySlug) },
    nationality: e.nationality,
    pax: e.travelers,
    adults: e.adults,
    children: e.children,
    travelDate: e.travelDate,
    valueAed: inAed ? e.totalAmount! : undefined,
    marketingOptOut: e.marketingOptOut,
  };
}

/** Legacy enquiry status to pipeline status. `closed` had no won/lost distinction, so it imports as lost/other. */
export function mapLegacyStatus(status: string | undefined): {
  status: LeadStatus;
  lostReason?: LostReason;
} {
  if (status === 'closed') return { status: 'lost', lostReason: 'other' };
  if (status === 'lost') return { status: 'lost', lostReason: 'other' };
  if (status && (LEAD_STATUSES as readonly string[]).includes(status)) return { status: status as LeadStatus };
  return { status: 'new' };
}

const LEGACY_JSON_STATUS: Record<string, string> = {
  new: 'new',
  contacted: 'contacted',
  quoted: 'quoted',
  converted: 'won',
  cancelled: 'lost',
};

/** A record of the old file based Next.js leads store (`app/data/leads.json`); null when it is unusable. */
export function fromLegacyJsonLead(l: Record<string, unknown>, now = new Date()): LeadSeed | null {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const name = str(l.name);
  const email = str(l.email).toLowerCase();
  const reference = str(l.reference);
  if (!name || !reference || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const created = new Date(str(l.createdAt));
  const amount = Number(l.totalAmount);
  const date = new Date(str(l.travelDate));
  const slug = str(l.holidaySlug);
  return {
    source: 'holiday',
    sourceRef: reference,
    catalog: slug ? { type: 'holiday', slug, title: str(l.holidayTitle) || undefined } : undefined,
    name,
    email,
    phone: str(l.phone) || undefined,
    nationality: str(l.nationality) || undefined,
    message: str(l.notes) || undefined,
    pax: Number(l.travelersCount) > 0 ? Math.min(100, Number(l.travelersCount)) : undefined,
    adults: Number(l.adults) >= 0 ? Number(l.adults) : undefined,
    children: Number(l.children) >= 0 ? Number(l.children) : undefined,
    travelDate: Number.isNaN(date.getTime()) ? undefined : date,
    valueAed: str(l.currency).toUpperCase() === 'AED' && amount > 0 ? amount : undefined,
    marketingOptOut: Boolean(l.optOutMarketing),
    consentAt: Number.isNaN(created.getTime()) ? now : created,
    createdAt: Number.isNaN(created.getTime()) ? undefined : created,
    legacyStatus: LEGACY_JSON_STATUS[str(l.status).toLowerCase()] ?? 'new',
  };
}

/** Default priority for a new lead: big-ticket holidays start as high. */
export function defaultPriority(seed: Pick<LeadSeed, 'valueAed'>): LeadPriority {
  return (seed.valueAed ?? 0) >= 10_000 ? 'high' : 'normal';
}
