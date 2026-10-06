import { Types } from 'mongoose';
import {
  defaultPriority,
  dedupeKey,
  dubaiDayBounds,
  evaluateTransition,
  followUpState,
  fromCruiseEnquiry,
  fromEventEnquiry,
  fromHolidayEnquiry,
  fromLegacyJsonLead,
  fromVisaEnquiry,
  LEAD_STATUSES,
  mapLegacyStatus,
  normalizePhone,
  type LeadStatus,
} from './leads.rules';

describe('lead status transitions', () => {
  it('rejects a no-op change', () => {
    expect(evaluateTransition('new', 'new')).toMatchObject({ ok: false, code: 'NO_CHANGE' });
  });

  it('lets open statuses move between each other', () => {
    const open: LeadStatus[] = ['contacted', 'qualified', 'quoted'];
    for (const from of open) {
      for (const to of open.filter((s) => s !== from)) {
        expect(evaluateTransition(from, to)).toEqual({ ok: true });
      }
    }
    expect(evaluateTransition('new', 'qualified')).toEqual({ ok: true });
  });

  it('never moves an open lead back to new', () => {
    expect(evaluateTransition('contacted', 'new')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('needs a valid lost reason to mark a lead lost', () => {
    expect(evaluateTransition('contacted', 'lost')).toMatchObject({ ok: false, code: 'LOST_REASON_REQUIRED' });
    expect(evaluateTransition('contacted', 'lost', 'made-up')).toMatchObject({ code: 'LOST_REASON_REQUIRED' });
    expect(evaluateTransition('new', 'lost', 'spam')).toEqual({ ok: true });
  });

  it('does not let a brand-new lead jump straight to won', () => {
    expect(evaluateTransition('new', 'won')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    expect(evaluateTransition('quoted', 'won')).toEqual({ ok: true });
  });

  it('only allows closed leads to be reopened to contacted', () => {
    for (const from of ['won', 'lost'] as const) {
      expect(evaluateTransition(from, 'contacted')).toEqual({ ok: true });
      for (const to of LEAD_STATUSES.filter((s) => s !== from && s !== 'contacted')) {
        expect(evaluateTransition(from, to, 'other')).toMatchObject({ ok: false, code: 'LEAD_CLOSED' });
      }
    }
  });
});

describe('follow-up state', () => {
  // 2026-10-05 10:00 Dubai = 06:00 UTC
  const now = new Date('2026-10-05T06:00:00Z');

  it('computes Dubai day bounds', () => {
    const { start, end } = dubaiDayBounds(now);
    expect(start.toISOString()).toBe('2026-10-04T20:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-05T20:00:00.000Z');
  });

  it('classifies overdue, today and upcoming', () => {
    expect(followUpState(new Date('2026-10-05T05:00:00Z'), 'contacted', now)).toBe('overdue');
    expect(followUpState(new Date('2026-10-05T12:00:00Z'), 'contacted', now)).toBe('today');
    expect(followUpState(new Date('2026-10-06T12:00:00Z'), 'new', now)).toBe('upcoming');
  });

  it('is none without a date and for closed leads', () => {
    expect(followUpState(null, 'new', now)).toBe('none');
    expect(followUpState(new Date('2026-10-01T00:00:00Z'), 'won', now)).toBe('none');
    expect(followUpState(new Date('2026-10-01T00:00:00Z'), 'lost', now)).toBe('none');
  });
});

describe('dedupe and normalisation', () => {
  it('builds a case-insensitive key per source and reference', () => {
    expect(dedupeKey('visa', ' vis-123456 ')).toBe('visa:VIS-123456');
    expect(dedupeKey('visa', 'VIS-123456')).toBe(dedupeKey('visa', 'vis-123456'));
    expect(dedupeKey('cruise', 'VIS-123456')).not.toBe(dedupeKey('visa', 'VIS-123456'));
  });

  it('normalises phone numbers', () => {
    expect(normalizePhone('+971 50-123 4567')).toBe('+971501234567');
    expect(normalizePhone('050 123 4567')).toBe('0501234567');
    expect(normalizePhone(undefined)).toBe('');
  });
});

describe('enquiry to lead mapping (backfill)', () => {
  const id = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const consentAt = new Date('2026-09-01T10:00:00Z');
  const common = {
    _id: id,
    reference: 'REF-100001',
    fullName: 'Aisha Khan',
    email: 'aisha@example.com',
    phone: '+971 50 123 4567',
    message: 'Hello',
    consentAt,
    createdAt: new Date('2026-09-01T10:00:00Z'),
  };

  it('maps a visa enquiry', () => {
    const seed = fromVisaEnquiry({
      ...common,
      visaSlug: 'uae-30-day-visa',
      nationality: 'India',
      travellers: 3,
      userId,
    });
    expect(seed).toMatchObject({
      source: 'visa',
      sourceRef: 'REF-100001',
      sourceId: id.toString(),
      name: 'Aisha Khan',
      pax: 3,
      nationality: 'India',
      userId: userId.toString(),
      catalog: { type: 'visa', slug: 'uae-30-day-visa', title: 'Uae 30 day visa' },
    });
  });

  it('maps a cruise enquiry and sums adults and children', () => {
    const seed = fromCruiseEnquiry({
      ...common,
      cruiseSlug: 'gulf-cruise',
      adults: 2,
      children: 1,
      cabinType: 'Balcony',
    });
    expect(seed).toMatchObject({ source: 'cruise', pax: 3, adults: 2, children: 1, subject: 'Cabin: Balcony' });
  });

  it('maps an event enquiry', () => {
    expect(fromEventEnquiry({ ...common, eventSlug: 'f1', tickets: 4, ticketType: 'VIP' })).toMatchObject({
      source: 'event',
      pax: 4,
      subject: 'Ticket type: VIP',
    });
  });

  it('keeps a holiday value only when it is in AED', () => {
    const aed = fromHolidayEnquiry({ ...common, holidaySlug: 'dubai-4n', travelers: 2, totalAmount: 5200, currency: 'AED' });
    expect(aed.valueAed).toBe(5200);
    const usd = fromHolidayEnquiry({ ...common, holidaySlug: 'dubai-4n', travelers: 2, totalAmount: 1400, currency: 'USD' });
    expect(usd.valueAed).toBeUndefined();
    const none = fromHolidayEnquiry({ ...common, holidaySlug: 'dubai-4n', totalAmount: 0, currency: 'AED' });
    expect(none.valueAed).toBeUndefined();
  });

  it('maps legacy statuses onto the pipeline', () => {
    expect(mapLegacyStatus('new')).toEqual({ status: 'new' });
    expect(mapLegacyStatus(undefined)).toEqual({ status: 'new' });
    expect(mapLegacyStatus('contacted')).toEqual({ status: 'contacted' });
    expect(mapLegacyStatus('closed')).toEqual({ status: 'lost', lostReason: 'other' });
  });

  it('flags big holiday values as high priority', () => {
    expect(defaultPriority({ valueAed: 12_000 })).toBe('high');
    expect(defaultPriority({ valueAed: 900 })).toBe('normal');
    expect(defaultPriority({})).toBe('normal');
  });
});

describe('legacy json lead mapping', () => {
  const legacy = {
    reference: 'HOL-739210',
    name: 'Sam Lee',
    email: 'Sam@Example.com',
    phone: '+971 50 111 2222',
    holidaySlug: 'dubai-4n',
    holidayTitle: 'Dubai 4 nights',
    travelersCount: 2,
    totalAmount: 4300,
    currency: 'AED',
    status: 'Converted',
    optOutMarketing: true,
    createdAt: '2026-08-01T09:00:00.000Z',
  };

  it('maps a record, lower-casing the e-mail and translating the status', () => {
    const seed = fromLegacyJsonLead(legacy)!;
    expect(seed).toMatchObject({ source: 'holiday', sourceRef: 'HOL-739210', email: 'sam@example.com', pax: 2, valueAed: 4300, legacyStatus: 'won', marketingOptOut: true });
    expect(mapLegacyStatus(seed.legacyStatus)).toEqual({ status: 'won' });
  });

  it('skips records without a usable name, reference or e-mail', () => {
    expect(fromLegacyJsonLead({ ...legacy, email: 'nope' })).toBeNull();
    expect(fromLegacyJsonLead({ ...legacy, name: '' })).toBeNull();
    expect(fromLegacyJsonLead({ ...legacy, reference: '' })).toBeNull();
  });
});
