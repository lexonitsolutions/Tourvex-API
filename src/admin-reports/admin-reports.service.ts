import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { dayStartUtc, dubaiDay } from '../finance/finance-rules';
import { STAFF_ROLES } from '../admin/permissions';
import { SettingsService } from '../admin/settings/settings.service';
import { BookingStatus } from '../bookings/schemas/booking.schema';
import { OPEN_STATUSES } from '../leads/leads.rules';
import { parseItemId } from '../stock/stock.types';
import type { MarginReportDto } from './admin-reports.dto';
import { addSums, marginRow, type MarginSums } from './margin-rules';
import {
  buildInsights,
  buildSummary,
  cacheKey,
  compare,
  compareRates,
  resolveRange,
  round2,
  shortName,
  sum,
  TtlCache,
  zeroFill,
  type Compare,
  type RangeInput,
  type ResolvedRange,
} from './reports-rules';

const TZ = 'Asia/Dubai';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const GONE = [BookingStatus.Cancelled, BookingStatus.Refunded];

/** Permission that gates each dashboard section; a section is omitted (and never computed) without it. */
export const SECTION_PERMISSIONS = {
  bookings: 'bookings.read',
  revenue: 'finance.read',
  leads: 'enquiries.read',
  tickets: 'tickets.read',
  customers: 'customers.read',
  vouchers: 'vouchers.read',
} as const;
type Section = keyof typeof SECTION_PERMISSIONS;

type Row = Record<string, any>;
const dayOf = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: TZ } });

/** A KPI card: the compare block plus the zero-filled daily series of the CURRENT range. */
export interface Kpi extends Compare {
  series: number[];
  /** Which direction is good news; the UI colours the badge with it. */
  goodWhen: 'up' | 'down';
}

@Injectable()
export class AdminReportsService {
  private readonly cache = new TtlCache<Record<string, unknown>>(60_000, 200);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly settings: SettingsService,
  ) {}

  private col(name: string) {
    return this.connection.collection(name);
  }

  resolve(input: RangeInput, now = new Date()): ResolvedRange {
    return resolveRange(input, now);
  }

  /** Per-day rows over both windows (previous + current) so one query serves the value, the delta and the series. */
  private async daily(collection: string, match: Row, dateField: string, accumulators: Row, start: Date, end: Date, extraKey: Row = {}): Promise<Row[]> {
    const rows = await this.col(collection)
      .aggregate([
        { $match: { ...match, [dateField]: { $gte: start, $lt: end } } },
        { $group: { _id: { day: dayOf(dateField), ...extraKey }, ...accumulators } },
      ])
      .toArray();
    return rows.map((r) => ({ ...r, day: (r._id as Row).day, ...(r._id as Row) }));
  }

  private metric(rows: Row[], key: string, range: ResolvedRange, goodWhen: 'up' | 'down' = 'up', money = false): Kpi {
    const fix = (n: number) => (money ? round2(n) : n);
    const perDay = new Map<string, number>();
    for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + (r[key] ?? 0));
    const series = zeroFill(range.days, perDay).map(fix);
    const previous = fix(sum(zeroFill(range.previous.days, perDay)));
    return { ...compare(fix(sum(series)), previous), series, goodWhen };
  }

  private total(rows: Row[], key: string, days: readonly string[]): number {
    const set = new Set(days);
    return sum(rows.filter((r) => set.has(r.day)).map((r) => r[key] ?? 0));
  }

  async dashboard(input: RangeInput, permissions: readonly string[], now = new Date()) {
    const range = this.resolve(input, now);
    const granted = new Set(permissions);
    const has = (s: Section) => granted.has(SECTION_PERMISSIONS[s]);
    const relevant = (Object.keys(SECTION_PERMISSIONS) as Section[]).filter(has).map((s) => SECTION_PERMISSIONS[s]);
    const key = cacheKey(range, relevant);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const { start, end } = { start: range.previous.start, end: range.end };
    const rangeMatch = { $gte: range.start, $lt: range.end };
    const today = this.todayWindow(now);
    const live = { $nin: ['expired'] };
    const out: Record<string, any> = {};
    const kpis: Record<string, unknown> = {};
    const intelligence: Record<string, unknown> = {};
    const breakdowns: Record<string, unknown> = {};
    const activity: Row[] = [];
    const insightInput: Parameters<typeof buildInsights>[0] = { rangeLabel: range.label };
    const tasks: Promise<void>[] = [];

    if (has('bookings')) {
      tasks.push(
        (async () => {
          const [rows, todayN, yesterdayN, requests, latest, latestRequests, requestRows] = await Promise.all([
            this.daily('bookings', { status: live }, 'createdAt', { n: { $sum: 1 }, gone: { $sum: { $cond: [{ $in: ['$status', GONE] }, 1, 0] } } }, start, end),
            this.col('bookings').countDocuments({ status: live, createdAt: { $gte: today.start, $lt: today.end } }),
            this.col('bookings').countDocuments({ status: live, createdAt: { $gte: today.yesterdayStart, $lt: today.start } }),
            this.col('bookings').countDocuments({ status: BookingStatus.CancellationRequested }),
            this.col('bookings').find({ status: live }).sort({ createdAt: -1 }).limit(6).project({ reference: 1, title: 1, 'customer.fullName': 1, total: 1, currency: 1, status: 1, createdAt: 1 }).toArray(),
            this.col('bookings').find({ status: BookingStatus.CancellationRequested }).sort({ cancellationRequestedAt: -1 }).limit(4).project({ reference: 1, title: 1, 'customer.fullName': 1, cancellationRequestedAt: 1, createdAt: 1 }).toArray(),
            this.daily('bookings', {}, 'cancellationRequestedAt', { n: { $sum: 1 } }, start, end),
          ]);
          const created = this.metric(rows, 'n', range);
          kpis.bookings = created;
          kpis.cancellationRequests = { pending: requests, requested: this.metric(requestRows, 'n', range, 'down') };
          const gone = this.total(rows, 'gone', range.days);
          const prevGone = this.total(rows, 'gone', range.previous.days);
          intelligence.bookingsToday = { ...compare(todayN, yesterdayN), comparedWith: 'yesterday (full day)' };
          intelligence.cancellationRate = { ...compareRates(gone, created.value, prevGone, created.previous), goodWhen: 'down' };
          insightInput.bookings = { value: created.value, previous: created.previous, pendingCancellationRequests: requests };
          out.pendingCancellationRequests = requests;
          for (const b of latest) {
            activity.push({ type: 'booking', id: String(b._id), title: `${b.reference} - ${b.title}`, subtitle: `${shortName(b.customer?.fullName)} · ${b.currency} ${round2(b.total ?? 0)}`, status: b.status, at: b.createdAt, href: `/admin/bookings/${b._id}` });
          }
          for (const b of latestRequests) {
            activity.push({ type: 'cancellation', id: String(b._id), title: `Cancellation request ${b.reference}`, subtitle: `${shortName(b.customer?.fullName)} · ${b.title}`, status: 'cancellation_requested', at: b.cancellationRequestedAt ?? b.createdAt, href: `/admin/bookings/${b._id}` });
          }
        })(),
      );
    }

    if (has('revenue')) {
      tasks.push(
        (async () => {
          const [rows, refunds, nonAed, top] = await Promise.all([
            this.daily('bookings', { currency: 'AED' }, 'confirmedAt', { revenue: { $sum: '$total' }, n: { $sum: 1 } }, start, end, { serviceType: '$serviceType' }),
            this.daily('refunds', { status: 'succeeded', currency: 'AED' }, 'createdAt', { amount: { $sum: '$amount' }, n: { $sum: 1 } }, start, end),
            this.col('bookings').countDocuments({ confirmedAt: rangeMatch, currency: { $ne: 'AED' } }),
            this.col('bookings')
              .aggregate([
                { $match: { confirmedAt: rangeMatch, currency: 'AED' } },
                { $group: { _id: { $ifNull: ['$activitySlug', '$title'] }, title: { $first: '$title' }, slug: { $first: '$activitySlug' }, revenue: { $sum: '$total' }, bookings: { $sum: 1 } } },
                { $sort: { revenue: -1, bookings: -1 } },
                { $limit: 5 },
              ])
              .toArray(),
          ]);
          const revenue = this.metric(rows, 'revenue', range, 'up', true);
          const refundKpi = this.metric(refunds, 'amount', range, 'down', true);
          const net = compare(round2(revenue.value - refundKpi.value), round2(revenue.previous - refundKpi.previous));
          const confirmed = this.total(rows, 'n', range.days);
          const prevConfirmed = this.total(rows, 'n', range.previous.days);
          kpis.revenue = { ...revenue, net, refunded: refundKpi };
          kpis.refunds = refundKpi;
          intelligence.revenue = revenue;
          intelligence.netRevenue = net;
          intelligence.refundTotal = { ...refundKpi, count: sum(zeroFill(range.days, new Map(refunds.map((r) => [r.day, r.n])))) };
          intelligence.averageBookingValue = compare(confirmed ? round2(revenue.value / confirmed) : 0, prevConfirmed ? round2(revenue.previous / prevConfirmed) : 0);
          const byType = new Map<string, { revenue: number; bookings: number }>();
          const inRange = new Set(range.days);
          for (const r of rows) {
            if (!inRange.has(r.day)) continue;
            const t = byType.get(r.serviceType) ?? { revenue: 0, bookings: 0 };
            t.revenue += r.revenue;
            t.bookings += r.n;
            byType.set(r.serviceType, t);
          }
          breakdowns.serviceTypes = [...byType].map(([serviceType, v]) => ({ serviceType, revenue: round2(v.revenue), bookings: v.bookings })).sort((a, b) => b.revenue - a.revenue);
          breakdowns.topActivities = top.map((t) => ({ title: t.title, slug: t.slug ?? null, revenue: round2(t.revenue), bookings: t.bookings }));
          insightInput.revenue = { value: revenue.value, previous: revenue.previous };
          insightInput.excludedNonAed = nonAed;
          out.excludedNonAed = nonAed;
        })(),
      );
    }

    if (has('leads')) {
      tasks.push(
        (async () => {
          const [rows, stages, overdue, unassigned, latest] = await Promise.all([
            this.daily('leads', {}, 'createdAt', { n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } } }, start, end),
            this.col('leads').aggregate([{ $match: { createdAt: rangeMatch } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
            this.col('leads').countDocuments({ status: { $in: [...OPEN_STATUSES] }, nextFollowUpAt: { $lt: now } }),
            this.col('leads').countDocuments({ status: { $in: [...OPEN_STATUSES] }, ownerId: null }),
            this.col('leads').find({}).sort({ createdAt: -1 }).limit(5).project({ reference: 1, name: 1, source: 1, subject: 1, status: 1, createdAt: 1 }).toArray(),
          ]);
          const leads = this.metric(rows, 'n', range);
          kpis.leads = leads;
          intelligence.leadConversion = compareRates(this.total(rows, 'won', range.days), leads.value, this.total(rows, 'won', range.previous.days), leads.previous);
          const order = ['new', 'contacted', 'qualified', 'quoted', 'won', 'lost'];
          const counts = new Map(stages.map((s) => [String(s._id), s.count as number]));
          breakdowns.leadPipeline = order.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
          insightInput.leads = { overdueFollowUps: overdue, unassignedOpen: unassigned };
          out.overdueFollowUps = overdue;
          for (const l of latest) {
            activity.push({ type: 'lead', id: String(l._id), title: `${l.reference} - ${l.subject || `${l.source} enquiry`}`, subtitle: shortName(l.name), status: l.status, at: l.createdAt, href: `/admin/leads?lead=${l._id}` });
          }
        })(),
      );
    }

    if (has('tickets')) {
      tasks.push(
        (async () => {
          const support = (await this.settings.get('support')) as { firstResponseHours: number; resolutionHours: number };
          const frMs = support.firstResponseHours * HOUR_MS;
          const due = { $add: ['$createdAt', frMs] };
          const answeredInTime = { $and: [{ $ne: [{ $ifNull: ['$firstResponseAt', null] }, null] }, { $lte: ['$firstResponseAt', due] }] };
          const missed = {
            $or: [
              { $and: [{ $ne: [{ $ifNull: ['$firstResponseAt', null] }, null] }, { $gt: ['$firstResponseAt', due] }] },
              { $and: [{ $eq: [{ $ifNull: ['$firstResponseAt', null] }, null] }, { $in: ['$status', ['open', 'pending']] }, { $lt: [due, now] }] },
            ],
          };
          const [rows, open, overdue, latest] = await Promise.all([
            this.daily('tickets', {}, 'createdAt', { n: { $sum: 1 }, met: { $sum: { $cond: [answeredInTime, 1, 0] } }, miss: { $sum: { $cond: [missed, 1, 0] } } }, start, end),
            this.col('tickets').countDocuments({ status: { $in: ['open', 'pending'] } }),
            this.overdueTickets(support, now),
            this.col('tickets').find({}).sort({ createdAt: -1 }).limit(5).project({ number: 1, subject: 1, 'requester.name': 1, status: 1, priority: 1, createdAt: 1 }).toArray(),
          ]);
          const created = this.metric(rows, 'n', range, 'down');
          kpis.tickets = { open, overdue, created };
          const met = this.total(rows, 'met', range.days);
          const miss = this.total(rows, 'miss', range.days);
          const sla = compareRates(met, met + miss, this.total(rows, 'met', range.previous.days), this.total(rows, 'met', range.previous.days) + this.total(rows, 'miss', range.previous.days));
          intelligence.slaCompliance = { ...sla, targetHours: support.firstResponseHours };
          insightInput.tickets = { overdue, sla: { compliance: sla.value, evaluated: met + miss, met } };
          for (const t of latest) {
            activity.push({ type: 'ticket', id: String(t._id), title: `${t.number} - ${t.subject}`, subtitle: `${shortName(t.requester?.name)} · ${t.priority}`, status: t.status, at: t.createdAt, href: `/admin/tickets/${t._id}` });
          }
        })(),
      );
    }

    if (has('customers')) {
      tasks.push(
        this.daily('users', { roles: { $in: ['customer'], $nin: [...STAFF_ROLES] } }, 'createdAt', { n: { $sum: 1 } }, start, end).then((rows) => {
          kpis.customers = this.metric(rows, 'n', range);
        }),
      );
    }
    if (has('vouchers')) {
      tasks.push(
        this.daily('vouchers', { status: 'redeemed' }, 'redeemedAt', { n: { $sum: 1 } }, start, end).then((rows) => {
          kpis.vouchers = this.metric(rows, 'n', range);
        }),
      );
    }
    await Promise.all(tasks);

    activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const insights = buildInsights(insightInput);
    const result: Record<string, unknown> = {
      generatedAt: now.toISOString(),
      currency: 'AED',
      timezone: TZ,
      range: { key: range.key, from: range.from, to: range.to, days: range.days, label: range.label },
      previousRange: { from: range.previous.from, to: range.previous.to },
      sections: (Object.keys(SECTION_PERMISSIONS) as Section[]).filter(has),
      kpis,
      intelligence,
      breakdowns,
      activity: activity.slice(0, 12),
      insights,
      summary: buildSummary(insights),
      notes: { excludedNonAed: has('revenue') ? (out.excludedNonAed ?? 0) : undefined },
    };
    this.cache.set(key, result);
    return result;
  }

  private todayWindow(now: Date) {
    const start = dayStartUtc(dubaiDay(now));
    return { start, end: new Date(start.getTime() + DAY_MS), yesterdayStart: new Date(start.getTime() - DAY_MS) };
  }

  /** Active tickets whose first-response or resolution target has passed. */
  private overdueTickets(support: { firstResponseHours: number; resolutionHours: number }, now: Date) {
    return this.col('tickets').countDocuments({
      status: { $in: ['open', 'pending'] },
      $or: [
        { firstResponseAt: null, createdAt: { $lt: new Date(now.getTime() - support.firstResponseHours * HOUR_MS) } },
        { createdAt: { $lt: new Date(now.getTime() - support.resolutionHours * HOUR_MS) } },
      ],
    });
  }

  // ------------------------------------------------------------------ reports

  async salesReport(input: RangeInput) {
    const range = this.resolve(input);
    const [rows, refunds, nonAed] = await Promise.all([
      this.daily('bookings', { currency: 'AED' }, 'confirmedAt', { revenue: { $sum: '$total' }, n: { $sum: 1 } }, range.start, range.end, { serviceType: '$serviceType' }),
      this.daily('refunds', { status: 'succeeded', currency: 'AED' }, 'createdAt', { amount: { $sum: '$amount' } }, range.start, range.end),
      this.col('bookings').countDocuments({ confirmedAt: { $gte: range.start, $lt: range.end }, currency: { $ne: 'AED' } }),
    ]);
    const types = [...new Set(rows.map((r) => r.serviceType as string))].sort();
    const dayRev = new Map<string, number>();
    const dayN = new Map<string, number>();
    const dayRef = new Map<string, number>();
    for (const r of rows) {
      dayRev.set(r.day, (dayRev.get(r.day) ?? 0) + r.revenue);
      dayN.set(r.day, (dayN.get(r.day) ?? 0) + r.n);
    }
    for (const r of refunds) dayRef.set(r.day, r.amount);
    const byDay = range.days.map((date) => {
      const revenue = round2(dayRev.get(date) ?? 0);
      const refunded = round2(dayRef.get(date) ?? 0);
      return { date, bookings: dayN.get(date) ?? 0, revenue, refunded, net: round2(revenue - refunded) };
    });
    const byService = types
      .map((serviceType) => ({ serviceType, bookings: sum(rows.filter((r) => r.serviceType === serviceType).map((r) => r.n)), revenue: round2(sum(rows.filter((r) => r.serviceType === serviceType).map((r) => r.revenue))) }))
      .sort((a, b) => b.revenue - a.revenue);
    const revenue = round2(sum(byDay.map((d) => d.revenue)));
    const refunded = round2(sum(byDay.map((d) => d.refunded)));
    const bookings = sum(byDay.map((d) => d.bookings));
    return {
      range: this.rangeView(range),
      currency: 'AED',
      totals: { bookings, revenue, refunded, net: round2(revenue - refunded), averageBookingValue: bookings ? round2(revenue / bookings) : 0 },
      byDay,
      byService,
      rows: rows
        .filter((r) => range.days.includes(r.day))
        .map((r) => ({ date: r.day as string, serviceType: r.serviceType as string, bookings: r.n as number, revenue: round2(r.revenue) }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.serviceType.localeCompare(b.serviceType)),
      excludedNonAed: nonAed,
    };
  }

  async topActivitiesReport(input: RangeInput) {
    const range = this.resolve(input);
    const rows = await this.col('bookings')
      .aggregate([
        { $match: { confirmedAt: { $gte: range.start, $lt: range.end }, currency: 'AED' } },
        { $group: { _id: { $ifNull: ['$activitySlug', '$title'] }, title: { $first: '$title' }, slug: { $first: '$activitySlug' }, serviceType: { $first: '$serviceType' }, revenue: { $sum: '$total' }, bookings: { $sum: 1 }, travellers: { $sum: { $add: [{ $ifNull: ['$adults', 0] }, { $ifNull: ['$children', 0] }] } } } },
        { $sort: { revenue: -1, bookings: -1 } },
        { $limit: 25 },
      ])
      .toArray();
    const total = sum(rows.map((r) => r.revenue));
    return {
      range: this.rangeView(range),
      currency: 'AED',
      rows: rows.map((r, i) => ({ rank: i + 1, title: r.title as string, slug: (r.slug as string) ?? null, serviceType: r.serviceType as string, bookings: r.bookings as number, travellers: r.travellers as number, revenue: round2(r.revenue), averageValue: round2(r.revenue / r.bookings), shareOfTopPct: total ? Math.round((r.revenue / total) * 1000) / 10 : 0 })),
    };
  }

  async leadFunnelReport(input: RangeInput) {
    const range = this.resolve(input);
    const match = { createdAt: { $gte: range.start, $lt: range.end } };
    const [daily, stages, sources, lost] = await Promise.all([
      this.daily('leads', {}, 'createdAt', { n: { $sum: 1 } }, range.start, range.end),
      this.col('leads').aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
      this.col('leads').aggregate([{ $match: match }, { $group: { _id: '$source', leads: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } }, lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } } } }, { $sort: { leads: -1 } }]).toArray(),
      this.col('leads').aggregate([{ $match: { ...match, status: 'lost' } }, { $group: { _id: { $ifNull: ['$lostReason', 'other'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
    ]);
    const order = ['new', 'contacted', 'qualified', 'quoted', 'won', 'lost'];
    const counts = new Map(stages.map((s) => [String(s._id), s.count as number]));
    const total = sum([...counts.values()]);
    const won = counts.get('won') ?? 0;
    const perDay = new Map(daily.map((r) => [r.day as string, r.n as number]));
    return {
      range: this.rangeView(range),
      definition: 'Leads created in the range, grouped by their CURRENT stage. Conversion = won / created.',
      totals: { leads: total, won, lost: counts.get('lost') ?? 0, conversionRate: total ? Math.round((won / total) * 1000) / 10 : null },
      stages: order.map((stage) => ({ stage, count: counts.get(stage) ?? 0 })),
      sources: sources.map((s) => ({ source: s._id as string, leads: s.leads as number, won: s.won as number, lost: s.lost as number, conversionRate: s.leads ? Math.round((s.won / s.leads) * 1000) / 10 : null })),
      lostReasons: lost.map((l) => ({ reason: l._id as string, count: l.count as number })),
      byDay: range.days.map((date, i) => ({ date, leads: zeroFill(range.days, perDay)[i] })),
    };
  }

  async supportSlaReport(input: RangeInput, now = new Date()) {
    const range = this.resolve(input, now);
    const support = (await this.settings.get('support')) as { firstResponseHours: number; resolutionHours: number };
    const frMs = support.firstResponseHours * HOUR_MS;
    const due = { $add: ['$createdAt', frMs] };
    const hasResponse = { $ne: [{ $ifNull: ['$firstResponseAt', null] }, null] };
    const outcome = {
      $switch: {
        branches: [
          { case: { $and: [hasResponse, { $lte: ['$firstResponseAt', due] }] }, then: 'met' },
          { case: hasResponse, then: 'late' },
          { case: { $and: [{ $in: ['$status', ['open', 'pending']] }, { $lt: [due, now] }] }, then: 'breached' },
          { case: { $in: ['$status', ['open', 'pending']] }, then: 'pending' },
        ],
        default: 'n/a',
      },
    };
    const match = { createdAt: { $gte: range.start, $lt: range.end } };
    const [byOutcome, daily, byCategory, avg] = await Promise.all([
      this.col('tickets').aggregate([{ $match: match }, { $group: { _id: outcome, count: { $sum: 1 } } }]).toArray(),
      this.daily('tickets', {}, 'createdAt', { created: { $sum: 1 }, resolved: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] } } }, range.start, range.end),
      this.col('tickets').aggregate([{ $match: match }, { $group: { _id: '$category', tickets: { $sum: 1 }, met: { $sum: { $cond: [{ $and: [hasResponse, { $lte: ['$firstResponseAt', due] }] }, 1, 0] } } } }, { $sort: { tickets: -1 } }]).toArray(),
      this.col('tickets').aggregate([{ $match: { ...match, firstResponseAt: { $ne: null } } }, { $group: { _id: null, ms: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } }, n: { $sum: 1 } } }]).toArray(),
    ]);
    const o = new Map(byOutcome.map((r) => [String(r._id), r.count as number]));
    const met = o.get('met') ?? 0;
    const evaluated = met + (o.get('late') ?? 0) + (o.get('breached') ?? 0);
    const created = new Map(daily.map((r) => [r.day as string, r.created as number]));
    const resolved = new Map(daily.map((r) => [r.day as string, r.resolved as number]));
    return {
      range: this.rangeView(range),
      definition: `First-response SLA: a ticket is met when its first public staff reply came within ${support.firstResponseHours} h of creation. Late replies and unanswered active tickets past the target count as missed; tickets still inside the target or closed without a reply are not counted.`,
      targets: support,
      totals: { created: sum([...o.values()]), met, late: o.get('late') ?? 0, breached: o.get('breached') ?? 0, pending: o.get('pending') ?? 0, notApplicable: o.get('n/a') ?? 0, compliancePct: evaluated ? Math.round((met / evaluated) * 1000) / 10 : null, averageFirstResponseHours: avg[0] ? Math.round((avg[0].ms / HOUR_MS) * 10) / 10 : null },
      byCategory: byCategory.map((c) => ({ category: c._id as string, tickets: c.tickets as number, metFirstResponse: c.met as number })),
      byDay: range.days.map((date) => ({ date, created: created.get(date) ?? 0, resolved: resolved.get(date) ?? 0 })),
    };
  }

  async cancellationsReport(input: RangeInput) {
    const range = this.resolve(input);
    const win = { $gte: range.start, $lt: range.end };
    const [created, cancelled, refunds, byType, requests] = await Promise.all([
      this.col('bookings').countDocuments({ createdAt: win, status: { $nin: ['expired'] } }),
      this.daily('bookings', { status: { $in: GONE } }, 'createdAt', { n: { $sum: 1 } }, range.start, range.end),
      this.daily('refunds', { status: 'succeeded', currency: 'AED' }, 'createdAt', { amount: { $sum: '$amount' }, n: { $sum: 1 } }, range.start, range.end),
      this.col('bookings').aggregate([{ $match: { createdAt: win, status: { $in: GONE } } }, { $group: { _id: '$serviceType', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
      this.col('bookings').countDocuments({ status: BookingStatus.CancellationRequested }),
    ]);
    const cn = new Map(cancelled.map((r) => [r.day as string, r.n as number]));
    const ra = new Map(refunds.map((r) => [r.day as string, r.amount as number]));
    const rn = new Map(refunds.map((r) => [r.day as string, r.n as number]));
    const byDay = range.days.map((date) => ({ date, cancelled: cn.get(date) ?? 0, refunds: rn.get(date) ?? 0, refundedAmount: round2(ra.get(date) ?? 0) }));
    const gone = sum(byDay.map((d) => d.cancelled));
    return {
      range: this.rangeView(range),
      currency: 'AED',
      definition: 'Cancellation rate = bookings created in the range that are now cancelled or refunded / bookings created in the range (expired holds excluded). Refunds are succeeded AED refunds dated in the range.',
      totals: { created, cancelledOrRefunded: gone, cancellationRatePct: created ? Math.round((gone / created) * 1000) / 10 : null, refunds: sum(byDay.map((d) => d.refunds)), refundedAmount: round2(sum(byDay.map((d) => d.refundedAmount))), pendingRequests: requests },
      byServiceType: byType.map((t) => ({ serviceType: t._id as string, count: t.count as number })),
      byDay,
    };
  }

  /**
   * Margin by product / day / month / service type. Per booking confirmed in the range (AED): revenue ex-tax = (total -
   * tax) x retained share (refunds subtract proportionally), tax from the tax snapshot, else the invoice, else 0
   * (see margin-rules.ts, which the pipeline mirrors). Cancelled or refunded bookings whose units went back to stock
   * are not sales and are left out. Cost comes from the cost snapshot; bookings without one are counted in
   * `bookingsWithoutCost` and excluded from the margin and margin %.
   */
  async marginReport(input: MarginReportDto) {
    const range = this.resolve(input);
    const groupBy = input.groupBy ?? 'product';
    const match: Row = {
      confirmedAt: { $gte: range.start, $lt: range.end },
      currency: 'AED',
      $nor: [{ status: { $in: GONE }, stockReleased: true }],
    };
    if (input.productType) match.serviceType = input.productType;
    if (input.supplierId) match.$or = await this.suppliedItems(input.supplierId);

    const key: unknown =
      groupBy === 'day'
        ? dayOf('confirmedAt')
        : groupBy === 'month'
          ? { $dateToString: { format: '%Y-%m', date: '$confirmedAt', timezone: TZ } }
          : groupBy === 'type'
            ? '$serviceType'
            : { $concat: ['$serviceType', ':', { $ifNull: ['$activitySlug', { $ifNull: ['$stockProductRef', '$title'] }] }] };
    const share = {
      $cond: [{ $gt: ['$total', 0] }, { $max: [0, { $min: [1, { $divide: [{ $subtract: ['$total', { $ifNull: ['$refundedAmount', 0] }] }, '$total'] }] }] }, 0],
    };
    const snapshotTax = { $cond: [{ $gt: [{ $size: { $ifNull: ['$taxComponents', []] } }, 0] }, { $sum: '$taxComponents.taxAmount' }, null] };

    const [rows, nonAed] = await Promise.all([
      this.col('bookings')
        .aggregate([
          { $match: match },
          { $project: { key: key, title: 1, quantity: { $ifNull: ['$quantity', 0] }, total: 1, refundedAmount: 1, cost: '$cost.total', taxComponents: 1 } },
          { $lookup: { from: 'invoices', let: { b: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$bookingId', '$b'] }, kind: { $ne: 'credit_note' } } }, { $project: { tax: 1 } }, { $limit: 1 }], as: 'inv' } },
          {
            $addFields: {
              tax0: { $min: ['$total', { $max: [0, { $ifNull: [snapshotTax, { $ifNull: [{ $first: '$inv.tax' }, 0] }] }] }] },
              share,
              hasCost: { $gte: ['$cost', 0] },
            },
          },
          { $addFields: { rev: { $round: [{ $multiply: [{ $subtract: ['$total', '$tax0'] }, '$share'] }, 2] }, taxKept: { $round: [{ $multiply: ['$tax0', '$share'] }, 2] } } },
          {
            $group: {
              _id: '$key',
              title: { $first: '$title' },
              bookings: { $sum: 1 },
              units: { $sum: '$quantity' },
              revenueExTax: { $sum: '$rev' },
              taxTotal: { $sum: '$taxKept' },
              cost: { $sum: { $cond: ['$hasCost', '$cost', 0] } },
              costedRevenue: { $sum: { $cond: ['$hasCost', '$rev', 0] } },
              bookingsWithoutCost: { $sum: { $cond: ['$hasCost', 0, 1] } },
            },
          },
          { $sort: groupBy === 'day' || groupBy === 'month' ? { _id: 1 } : { revenueExTax: -1, _id: 1 } },
          { $limit: 500 },
        ])
        .toArray(),
      this.col('bookings').countDocuments({ confirmedAt: { $gte: range.start, $lt: range.end }, currency: { $ne: 'AED' } }),
    ]);
    const sums = rows.map((r) => ({ key: String(r._id), title: groupBy === 'day' || groupBy === 'month' ? String(r._id) : ((r.title as string) ?? String(r._id)), sums: r as unknown as MarginSums }));
    return {
      range: this.rangeView(range),
      currency: 'AED',
      groupBy,
      definition: 'Revenue ex-tax = booking total minus tax (tax snapshot, else invoice, else 0), reduced by the refunded share. Cost = supplier cost snapshot taken when the booking was confirmed. Margin and margin % only count bookings that have a cost (bookingsWithoutCost shows the rest). Bookings cancelled or refunded with their units returned to stock are excluded. marginPct is a percentage of revenue ex-tax.',
      rows: sums.map(({ key: k, title, sums: s }) => ({ key: k, title, ...marginRow(s) })),
      totals: marginRow(addSums(sums.map((s) => s.sums))),
      excludedNonAed: nonAed,
    };
  }

  /** `$or` conditions matching bookings of the stock items that appear on received / paid purchases of the supplier. */
  private async suppliedItems(supplierId: string): Promise<Row[]> {
    const purchases = await this.col('purchases')
      .find({ supplierId: new Types.ObjectId(supplierId), status: { $in: ['received', 'paid'] } })
      .project({ 'lines.itemId': 1 })
      .toArray();
    const byProduct = new Map<string, { type: string; ref: string; variants: Set<string> }>();
    for (const purchase of purchases) {
      for (const line of (purchase.lines ?? []) as Array<{ itemId: string }>) {
        const key = parseItemId(line.itemId);
        if (!key) continue;
        const id = `${key.productType}|${key.productRef}`;
        const entry = byProduct.get(id) ?? { type: key.productType, ref: key.productRef, variants: new Set<string>() };
        entry.variants.add(key.variantId);
        byProduct.set(id, entry);
      }
    }
    if (!byProduct.size) return [{ _id: { $exists: false } }]; // nothing was bought from this supplier: no booking matches
    return [...byProduct.values()].map(({ type, ref, variants }) =>
      type === 'activity'
        ? { activitySlug: ref, optionId: { $in: [...variants] } }
        : { stockProductType: type, stockProductRef: ref, stockVariantId: { $in: [...variants] } },
    );
  }

  private rangeView(r: ResolvedRange) {
    return { key: r.key, from: r.from, to: r.to, days: r.days.length, label: r.label };
  }
}
