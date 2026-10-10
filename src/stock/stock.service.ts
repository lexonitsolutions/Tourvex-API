import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { Model, Types } from 'mongoose';
import { SettingsService } from '../admin/settings/settings.service';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { addDays, operatingToday } from '../catalog/activity-booking.utils';
import { Activity } from '../catalog/schemas/activity.schema';
import { CapacityLock } from '../catalog/schemas/capacity-lock.schema';
import { CartSession } from '../checkout/schemas/cart-session.schema';
import { CacheService } from '../common/cache/cache.service';
import { Cruise } from '../cruises/schemas/cruise.schema';
import { Event } from '../events/schemas/event.schema';
import { Holiday } from '../holidays/schemas/holiday.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { StockAlertState } from './schemas/stock-alert-state.schema';
import { StockDay } from './schemas/stock-day.schema';
import { StockMovement } from './schemas/stock-movement.schema';
import { StockPolicy } from './schemas/stock-policy.schema';
import {
  activityOperational,
  alertCandidates,
  alertKey,
  combineVariants,
  computeDay,
  diffAlerts,
  operatingDayOf,
  publicStock,
  restockDecision,
  sameStockStatus,
  summarizeHorizon,
  summarizeWindow,
  type AlertCandidate,
  type DayFigures,
  type DayOverride,
  type HorizonSummary,
  type ProductStockStatus,
  type RestockDecision,
  type WindowSummary,
} from './stock.rules';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  HORIZON_DAYS,
  WINDOW_DAYS,
  formatItemId,
  itemKeyString,
  type CatalogProductType,
  type ItemKey,
  type LockKey,
  type MovementType,
  type ProductType,
} from './stock.types';

/** Product-level reference; `variantId` narrows a lookup to one item. */
export interface ProductRef {
  productType: ProductType;
  productRef: string;
  variantId?: string;
}

/** A sellable unit type with everything needed to derive its stock. */
export interface VariantSource extends ItemKey {
  title: string;
  variantLabel: string;
  /** Activities only: the option's old `dailyCapacity`. */
  legacyCapacity: number | null;
  /** Activities only: the option's booking cutoff in hours. */
  cutoffHours: number | null;
  startTime: string | null;
  /** True when the product runs that day. */
  operational: (date: string, now: Date) => boolean;
  /** Derived from the catalog (virtual) rather than created by hand. */
  catalog: boolean;
}

export interface ProductSource {
  productType: ProductType;
  productRef: string;
  title: string;
  variants: VariantSource[];
  /** Catalog products only: the document to write `stockStatus` to, and what it holds now. */
  docId?: Types.ObjectId;
  currentStatus?: Partial<ProductStockStatus> | null;
}

export interface UsageCell {
  sold: number;
  held: number;
}
type UsageMap = Map<string, Map<string, UsageCell>>;

export interface UsageOptions {
  session?: ClientSession;
  /** Ignore one cart's own holds (it is the cart being added to, modified or paid). */
  excludeCartId?: string;
  /** Ignore one order's own bookings (it is the order being created). */
  excludeOrderReference?: string;
}

export interface StockContext {
  now: Date;
  today: string;
  policies: Map<string, StockPolicy>;
  days: Map<string, Map<string, DayOverride>>;
  usage: UsageMap;
}

export interface VariantSnapshot {
  source: VariantSource;
  policy?: StockPolicy;
  window: WindowSummary;
  horizon: HorizonSummary;
  alerts: AlertCandidate[];
}

export interface ProductSnapshot {
  source: ProductSource;
  variants: VariantSnapshot[];
}

/** What one date of one item allows: the effective limit (null = unlimited), whether it is closed, and what is taken. */
export interface CapacityInfo {
  limit: number | null;
  closed: boolean;
  booked: number;
  sold: number;
  held: number;
  available: number | null;
  threshold: number;
}

export interface MovementInput {
  actor?: { id: string; email: string };
  key: ItemKey;
  title: string;
  type: MovementType;
  date?: string | null;
  before?: number | null;
  after?: number | null;
  delta?: number | null;
  reason?: string;
  bookingReference?: string;
  meta?: Record<string, unknown>;
  at?: Date;
}

/** The identity of what a booking took from stock, or null for bookings that never touch it. */
export interface BookingStockFacts {
  reference: string;
  status: string;
  title?: string;
  quantity: number;
  serviceDay?: string;
  startTime?: string;
  activitySlug?: string;
  optionId?: string;
  stockProductType?: string;
  stockProductRef?: string;
  stockVariantId?: string;
  stockReleased?: boolean;
}

export function bookingStockKey(booking: BookingStockFacts): (ItemKey & { day: string }) | null {
  if (!booking.serviceDay) return null;
  if (booking.stockProductType && booking.stockProductRef && booking.stockVariantId) {
    return {
      productType: booking.stockProductType as ProductType,
      productRef: booking.stockProductRef,
      variantId: booking.stockVariantId,
      day: booking.serviceDay,
    };
  }
  if (booking.activitySlug && booking.optionId) {
    return { productType: 'activity', productRef: booking.activitySlug, variantId: booking.optionId, day: booking.serviceDay };
  }
  return null;
}

/** Bookings that still hold units: paid ones (also while a cancellation is requested) and cancelled ones that kept them. */
const SOLD_STATUSES = [BookingStatus.Confirmed, BookingStatus.CancellationRequested];

const CACHE_NAMESPACE: Record<CatalogProductType, string> = {
  activity: 'catalog',
  holiday: 'holidays',
  cruise: 'cruises',
  event: 'events',
};

/** `today` for figures whose status is not used, so no date counts as past. */
const PAST_NEVER = '0000-01-01';
const SWEEP_MS = 5 * 60_000;
const SNAPSHOT_MEMO_MS = 15_000;
const MAX_ALERT_LINES = 40;

const isCatalogType = (type: string): type is CatalogProductType => type in CACHE_NAMESPACE;

/**
 * THE derivation of capacity, sold, held, available and status for any item and date (activities, holidays, cruises,
 * events and manual items). Public availability, the checkout oversell guard, the enquiry confirmation and every
 * admin screen read their numbers from here.
 *
 * Count rule: sold = confirmed bookings (plus cancellation_requested, plus cancelled/refunded bookings whose units were
 * NOT returned); held = unexpired pending_payment bookings and open cart holds.
 * Capacity: date override > policy default > legacy option.dailyCapacity > unlimited.
 */
@Injectable()
export class StockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockService.name);
  private readonly isTest: boolean;
  private timer?: NodeJS.Timeout;
  private warmup?: NodeJS.Timeout;
  private sweeping = false;
  private memo?: { at: number; value: { ctx: StockContext; products: ProductSnapshot[] } };

  constructor(
    @InjectModel(Activity.name) private readonly activities: Model<Activity>,
    @InjectModel(Holiday.name) private readonly holidays: Model<Holiday>,
    @InjectModel(Cruise.name) private readonly cruises: Model<Cruise>,
    @InjectModel(Event.name) private readonly events: Model<Event>,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(CartSession.name) private readonly carts: Model<CartSession>,
    @InjectModel(CapacityLock.name) private readonly locks: Model<CapacityLock>,
    @InjectModel(StockPolicy.name) readonly policies: Model<StockPolicy>,
    @InjectModel(StockDay.name) readonly dayDocs: Model<StockDay>,
    @InjectModel(StockMovement.name) readonly movements: Model<StockMovement>,
    @InjectModel(StockAlertState.name) private readonly alertStates: Model<StockAlertState>,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {
    this.isTest = config.get<string>('NODE_ENV') === 'test';
  }

  onModuleInit() {
    if (this.isTest) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
    // One early pass after boot so a fresh deployment has its flags and alert state without waiting 5 minutes.
    this.warmup = setTimeout(() => void this.sweep(), 20_000);
    this.warmup.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.warmup) clearTimeout(this.warmup);
  }

  // --------------------------------------------------------------------- locks

  /** Activities keep their original lock keys (`slug|option|day`); every other product type adds its type. */
  lockKey(key: LockKey): string {
    return key.productType === 'activity'
      ? `${key.productRef}|${key.variantId}|${key.day}`
      : `${key.productType}|${key.productRef}|${key.variantId}|${key.day}`;
  }

  /** Makes sure the lock rows exist. Run it BEFORE the transaction: creating them inside would race on the unique key. */
  async ensureLocks(keys: LockKey[]): Promise<void> {
    for (const key of new Set(keys.map((k) => this.lockKey(k)))) {
      try {
        await this.locks.updateOne({ key }, { $setOnInsert: { key, version: 0 } }, { upsert: true }).exec();
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error; // a concurrent request created it first
      }
    }
  }

  /**
   * Takes the capacity locks inside a transaction. Sorted, so two transactions never wait on each other in a circle.
   * A concurrent transaction on the same item and day makes this one conflict and retry, and the retry sees its bookings.
   */
  async lock(keys: LockKey[], session: ClientSession): Promise<void> {
    for (const key of [...new Set(keys.map((k) => this.lockKey(k)))].sort()) {
      await this.locks.updateOne({ key }, { $inc: { version: 1 }, $set: { touchedAt: new Date() } }, { session }).exec();
    }
  }

  // --------------------------------------------------------------------- usage

  /** Sold and held units per item and service day in [from, to] (inclusive). Keys are `itemKeyString`. */
  async loadUsage(refs: ProductRef[] | null, from: string, to: string, now: Date, options: UsageOptions = {}): Promise<UsageMap> {
    const { session, excludeCartId, excludeOrderReference } = options;
    if (refs && refs.length === 0) return new Map();
    const scope: Record<string, unknown>[] = [];
    if (refs) {
      for (const ref of refs) {
        scope.push(
          ref.productType === 'activity'
            ? { activitySlug: ref.productRef, ...(ref.variantId && { optionId: ref.variantId }) }
            : {
                stockProductType: ref.productType,
                stockProductRef: ref.productRef,
                ...(ref.variantId && { stockVariantId: ref.variantId }),
              },
        );
      }
    }
    const bookingMatch: Record<string, unknown>[] = [
      { serviceDay: { $gte: from, $lte: to } },
      {
        $or: [
          { status: { $in: SOLD_STATUSES } },
          { status: BookingStatus.PendingPayment, holdExpiresAt: { $gt: now } },
          { status: { $in: [BookingStatus.Cancelled, BookingStatus.Refunded] }, stockReleased: false },
        ],
      },
    ];
    if (scope.length) bookingMatch.push({ $or: scope });
    if (excludeOrderReference) bookingMatch.push({ orderReference: { $ne: excludeOrderReference } });

    const activitySlugs = refs ? [...new Set(refs.filter((r) => r.productType === 'activity').map((r) => r.productRef))] : null;
    const wantsCarts = !refs || activitySlugs!.length > 0;
    const cartItemMatch: Record<string, unknown> = { date: { $gte: from, $lte: to } };
    if (activitySlugs) cartItemMatch.activitySlug = { $in: activitySlugs };
    const singleOption = refs?.length === 1 && refs[0].productType === 'activity' ? refs[0].variantId : undefined;
    if (singleOption) cartItemMatch.optionId = singleOption;

    const [booked, held] = await Promise.all([
      this.bookings
        .aggregate<{ _id: { t: string; r: string; v: string; d: string; h: boolean }; qty: number }>([
          { $match: { $and: bookingMatch } },
          {
            $group: {
              _id: {
                t: { $ifNull: ['$stockProductType', 'activity'] },
                r: { $ifNull: ['$stockProductRef', '$activitySlug'] },
                v: { $ifNull: ['$stockVariantId', '$optionId'] },
                d: '$serviceDay',
                h: { $eq: ['$status', BookingStatus.PendingPayment] },
              },
              qty: { $sum: '$quantity' },
            },
          },
        ])
        .session(session ?? null)
        .exec(),
      wantsCarts
        ? this.carts
            .aggregate<{ _id: { r: string; v: string; d: string }; qty: number }>([
              {
                $match: {
                  status: 'open',
                  expiresAt: { $gt: now },
                  ...(excludeCartId && { _id: { $ne: new Types.ObjectId(excludeCartId) } }),
                  items: { $elemMatch: cartItemMatch },
                },
              },
              { $unwind: '$items' },
              { $match: Object.fromEntries(Object.entries(cartItemMatch).map(([k, v]) => [`items.${k}`, v])) },
              {
                $group: {
                  _id: { r: '$items.activitySlug', v: '$items.optionId', d: '$items.date' },
                  qty: { $sum: { $add: ['$items.adults', '$items.children'] } },
                },
              },
            ])
            .session(session ?? null)
            .exec()
        : Promise.resolve([]),
    ]);

    const usage: UsageMap = new Map();
    const add = (type: string, ref: string, variant: string, date: string, qty: number, isHeld: boolean) => {
      if (!ref || !variant || !date) return;
      const key = itemKeyString({ productType: type as ProductType, productRef: ref, variantId: variant });
      let perDay = usage.get(key);
      if (!perDay) usage.set(key, (perDay = new Map()));
      const cell = perDay.get(date) ?? { sold: 0, held: 0 };
      if (isHeld) cell.held += qty;
      else cell.sold += qty;
      perDay.set(date, cell);
    };
    for (const row of booked) add(row._id.t, row._id.r, row._id.v, row._id.d, row.qty, row._id.h);
    for (const row of held) add('activity', row._id.r, row._id.v, row._id.d, row.qty, true);
    return usage;
  }

  /**
   * Capacity figures of ONE item for the dates in [from, to]. The hot path of the oversell guard and of the public
   * availability: three small queries (policy, date overrides, usage). `legacyCapacity` is the activity option's
   * `dailyCapacity`. Pass `session` to read inside the order transaction.
   */
  async capacityInfo(
    key: ItemKey,
    legacyCapacity: number | null,
    from: string,
    to: string,
    now: Date,
    options: UsageOptions = {},
  ): Promise<Map<string, CapacityInfo>> {
    const session = options.session ?? null;
    const [policy, overrides, usage] = await Promise.all([
      this.policies.findOne(key).session(session).lean<StockPolicy>().exec(),
      this.dayDocs.find({ ...key, date: { $gte: from, $lte: to } }).session(session).lean<StockDay[]>().exec(),
      this.loadUsage([key], from, to, now, options),
    ]);
    const byDate = new Map(overrides.map((doc) => [doc.date, doc]));
    const perDay = usage.get(itemKeyString(key));
    const result = new Map<string, CapacityInfo>();
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const override = byDate.get(date);
      const cell = perDay?.get(date) ?? { sold: 0, held: 0 };
      const figures = computeDay({
        date,
        today: PAST_NEVER,
        override: override ? { capacity: override.capacity, closed: override.closed, note: override.note } : null,
        defaultCapacity: policy?.defaultCapacity ?? null,
        legacyCapacity,
        stopSale: policy?.stopSale ?? false,
        lowStockThreshold: policy?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
        sold: cell.sold,
        held: cell.held,
        operational: true,
      });
      result.set(date, {
        limit: figures.capacity,
        closed: figures.closed || Boolean(policy?.stopSale),
        booked: cell.sold + cell.held,
        sold: cell.sold,
        held: cell.held,
        available: figures.available,
        threshold: policy?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
      });
    }
    return result;
  }

  // ------------------------------------------------------------------- sources

  /** Catalog products (activities, holidays, cruises, events) with their variants; `refs` narrows the load. */
  async loadCatalog(refs: ProductRef[] | null): Promise<ProductSource[]> {
    const slugs = (type: CatalogProductType) => {
      if (!refs) return null;
      const list = refs.filter((r) => r.productType === type).map((r) => r.productRef);
      return list.length ? [...new Set(list)] : [];
    };
    const filterFor = (type: CatalogProductType) => {
      const list = slugs(type);
      if (list && list.length === 0) return null;
      return list ? { slug: { $in: list } } : {};
    };
    const out: ProductSource[] = [];

    const activityFilter = filterFor('activity');
    if (activityFilter) {
      const docs = await this.activities
        .find(activityFilter, {
          slug: 1,
          'title.en': 1,
          stockStatus: 1,
          'options.id': 1,
          'options.name': 1,
          'options.operatingWeekdays': 1,
          'options.blackoutDates': 1,
          'options.cutoffHours': 1,
          'options.startTime': 1,
          'options.dailyCapacity': 1,
        })
        .lean()
        .exec();
      for (const doc of docs) {
        const title = doc.title?.en ?? doc.slug;
        out.push({
          productType: 'activity',
          productRef: doc.slug,
          title,
          docId: doc._id,
          currentStatus: doc.stockStatus ?? null,
          variants: (doc.options ?? []).map((option) => ({
            productType: 'activity' as const,
            productRef: doc.slug,
            variantId: option.id,
            title,
            variantLabel: option.name,
            legacyCapacity: option.dailyCapacity ?? null,
            cutoffHours: option.cutoffHours ?? null,
            startTime: option.startTime ?? null,
            catalog: true,
            operational: (date: string, now: Date) =>
              activityOperational(
                {
                  operatingWeekdays: option.operatingWeekdays ?? [0, 1, 2, 3, 4, 5, 6],
                  blackoutDates: option.blackoutDates ?? [],
                  cutoffHours: option.cutoffHours ?? 0,
                  startTime: option.startTime ?? null,
                },
                date,
                now,
              ),
          })),
        });
      }
    }

    const holidayFilter = filterFor('holiday');
    if (holidayFilter) {
      const docs = await this.holidays.find(holidayFilter, { slug: 1, title: 1, stockStatus: 1 }).lean().exec();
      for (const doc of docs) {
        out.push({
          productType: 'holiday',
          productRef: doc.slug,
          title: doc.title,
          docId: doc._id,
          currentStatus: doc.stockStatus ?? null,
          variants: [
            {
              productType: 'holiday',
              productRef: doc.slug,
              variantId: 'default',
              title: doc.title,
              variantLabel: 'Departures',
              legacyCapacity: null,
              cutoffHours: null,
              startTime: null,
              catalog: true,
              operational: () => true,
            },
          ],
        });
      }
    }

    const cruiseFilter = filterFor('cruise');
    if (cruiseFilter) {
      const docs = await this.cruises.find(cruiseFilter, { slug: 1, title: 1, stockStatus: 1, departures: 1, 'cabins.type': 1 }).lean().exec();
      for (const doc of docs) {
        const dates = new Set((doc.departures ?? []).map((d) => new Date(d).toISOString().slice(0, 10)));
        const cabins = (doc.cabins ?? []).map((c) => c.type);
        out.push({
          productType: 'cruise',
          productRef: doc.slug,
          title: doc.title,
          docId: doc._id,
          currentStatus: doc.stockStatus ?? null,
          variants: (cabins.length ? cabins : ['default']).map((cabin) => ({
            productType: 'cruise' as const,
            productRef: doc.slug,
            variantId: cabin,
            title: doc.title,
            variantLabel: cabin === 'default' ? 'Sailings' : cabin,
            legacyCapacity: null,
            cutoffHours: null,
            startTime: null,
            catalog: true,
            operational: (date: string) => dates.has(date),
          })),
        });
      }
    }

    const eventFilter = filterFor('event');
    if (eventFilter) {
      const docs = await this.events.find(eventFilter, { slug: 1, title: 1, stockStatus: 1, 'sessions.startsAt': 1, 'ticketTypes.type': 1 }).lean().exec();
      for (const doc of docs) {
        const dates = new Set((doc.sessions ?? []).map((s) => operatingDayOf(new Date(s.startsAt))));
        const tickets = (doc.ticketTypes ?? []).map((t) => t.type);
        out.push({
          productType: 'event',
          productRef: doc.slug,
          title: doc.title,
          docId: doc._id,
          currentStatus: doc.stockStatus ?? null,
          variants: (tickets.length ? tickets : ['default']).map((ticket) => ({
            productType: 'event' as const,
            productRef: doc.slug,
            variantId: ticket,
            title: doc.title,
            variantLabel: ticket === 'default' ? 'Tickets' : ticket,
            legacyCapacity: null,
            cutoffHours: null,
            startTime: null,
            catalog: true,
            operational: (date: string) => dates.has(date),
          })),
        });
      }
    }
    return out;
  }

  /** Manual items (yacht, transfer, hotel, custom): one product per `productRef`, built from their policies. */
  async loadManual(refs: ProductRef[] | null): Promise<ProductSource[]> {
    const manualRefs = refs?.filter((r) => !isCatalogType(r.productType));
    if (refs && !manualRefs!.length) return [];
    const filter: Record<string, unknown> = { productType: { $nin: Object.keys(CACHE_NAMESPACE) } };
    if (manualRefs) filter.$or = manualRefs.map((r) => ({ productType: r.productType, productRef: r.productRef }));
    const docs = await this.policies.find(filter).sort({ productType: 1, productRef: 1, variantId: 1 }).lean<StockPolicy[]>().exec();
    const grouped = new Map<string, ProductSource>();
    for (const policy of docs) {
      const id = `${policy.productType}|${policy.productRef}`;
      let product = grouped.get(id);
      if (!product) {
        product = { productType: policy.productType, productRef: policy.productRef, title: policy.title || policy.productRef, variants: [] };
        grouped.set(id, product);
      }
      product.variants.push({
        productType: policy.productType,
        productRef: policy.productRef,
        variantId: policy.variantId,
        title: policy.title || policy.productRef,
        variantLabel: policy.variantLabel ?? '',
        legacyCapacity: null,
        cutoffHours: null,
        startTime: null,
        catalog: false,
        operational: () => true,
      });
    }
    return [...grouped.values()];
  }

  async loadSources(refs: ProductRef[] | null): Promise<ProductSource[]> {
    const [catalog, manual] = await Promise.all([this.loadCatalog(refs), this.loadManual(refs)]);
    return [...catalog, ...manual];
  }

  /** One item, or null when it is neither a catalog variant nor a manual item. */
  async loadVariant(key: ItemKey): Promise<VariantSource | null> {
    const products = await this.loadSources([{ productType: key.productType, productRef: key.productRef }]);
    return products.flatMap((p) => p.variants).find((v) => v.variantId === key.variantId) ?? null;
  }

  // ------------------------------------------------------------------ evaluation

  /** Policies, date overrides and usage for everything in scope over today .. today + horizon - 1. */
  async loadContext(refs: ProductRef[] | null, now: Date, horizon = HORIZON_DAYS, range?: { from: string; to: string }): Promise<StockContext> {
    const today = operatingToday(now);
    const first = range?.from ?? today;
    const last = range?.to ?? addDays(today, horizon - 1);
    const scope = refs?.length
      ? { $or: refs.map((r) => ({ productType: r.productType, productRef: r.productRef })) }
      : {};
    const [policyDocs, dayRows, usage] = await Promise.all([
      this.policies.find(scope).lean<StockPolicy[]>().exec(),
      this.dayDocs.find({ ...scope, date: { $gte: first, $lte: last } }).lean<StockDay[]>().exec(),
      this.loadUsage(refs, first, last, now),
    ]);
    const policies = new Map(policyDocs.map((p) => [itemKeyString(p), p]));
    const days = new Map<string, Map<string, DayOverride>>();
    for (const row of dayRows) {
      const key = itemKeyString(row);
      let perDay = days.get(key);
      if (!perDay) days.set(key, (perDay = new Map()));
      perDay.set(row.date, { capacity: row.capacity ?? null, closed: row.closed, note: row.note ?? '' });
    }
    return { now, today, policies, days, usage };
  }

  /** Day by day figures of one variant over `count` days starting at `from`, from an already loaded context. */
  evaluate(source: VariantSource, ctx: StockContext, from: string, count: number): DayFigures[] {
    const key = itemKeyString(source);
    const policy = ctx.policies.get(key);
    const overrides = ctx.days.get(key);
    const usage = ctx.usage.get(key);
    const out: DayFigures[] = [];
    let date = from;
    for (let i = 0; i < count; i += 1, date = addDays(date, 1)) {
      const cell = usage?.get(date);
      out.push(
        computeDay({
          date,
          today: ctx.today,
          override: overrides?.get(date) ?? null,
          defaultCapacity: policy?.defaultCapacity ?? null,
          legacyCapacity: source.legacyCapacity,
          stopSale: policy?.stopSale ?? false,
          lowStockThreshold: policy?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
          sold: cell?.sold ?? 0,
          held: cell?.held ?? 0,
          operational: source.operational(date, ctx.now),
        }),
      );
    }
    return out;
  }

  snapshotOf(source: VariantSource, ctx: StockContext): VariantSnapshot {
    const policy = ctx.policies.get(itemKeyString(source));
    const days = this.evaluate(source, ctx, ctx.today, HORIZON_DAYS);
    const window = days.slice(0, WINDOW_DAYS);
    return {
      source,
      policy,
      window: summarizeWindow(window, {
        stopSale: policy?.stopSale,
        defaultCapacity: policy?.defaultCapacity ?? null,
        legacyCapacity: source.legacyCapacity,
      }),
      horizon: summarizeHorizon(days, ctx.today),
      alerts: alertCandidates(window),
    };
  }

  /** Snapshots of every variant in scope (null = everything). */
  async snapshots(refs: ProductRef[] | null, now = new Date()): Promise<{ ctx: StockContext; products: ProductSnapshot[] }> {
    const [sources, ctx] = await Promise.all([this.loadSources(refs), this.loadContext(refs, now)]);
    return {
      ctx,
      products: sources.map((source) => ({ source, variants: source.variants.map((variant) => this.snapshotOf(variant, ctx)) })),
    };
  }

  /** `snapshots(null)` shared for a few seconds by the admin list and summary (cleared by every stock change). */
  async allSnapshots(now = new Date()): Promise<{ ctx: StockContext; products: ProductSnapshot[] }> {
    if (!this.isTest && this.memo && Date.now() - this.memo.at < SNAPSHOT_MEMO_MS) return this.memo.value;
    const value = await this.snapshots(null, now);
    this.memo = { at: Date.now(), value };
    return value;
  }

  /** Forget memoised admin figures; call after anything that changes stock. */
  touch() {
    this.memo = undefined;
  }

  /** Available units of one item on one day right now (null = unlimited or unknown item). */
  async availableOn(key: ItemKey, date: string, now = new Date(), session?: ClientSession): Promise<number | null> {
    const variant = await this.loadVariant(key);
    if (!variant) return null;
    const info = (await this.capacityInfo(key, variant.legacyCapacity, date, date, now, { session })).get(date);
    return info?.available ?? null;
  }

  // -------------------------------------------------------------------- ledger

  async recordMovements(rows: MovementInput[], session?: ClientSession): Promise<void> {
    if (!rows.length) return;
    const docs = rows.map((row) => ({
      at: row.at ?? new Date(),
      ...(row.actor && { actorId: new Types.ObjectId(row.actor.id) }),
      actorEmail: row.actor?.email ?? 'system',
      productType: row.key.productType,
      productRef: row.key.productRef,
      variantId: row.key.variantId,
      title: row.title,
      type: row.type,
      date: row.date ?? null,
      before: row.before ?? null,
      after: row.after ?? null,
      delta: row.delta ?? null,
      reason: (row.reason ?? '').slice(0, 500),
      ...(row.bookingReference && { bookingReference: row.bookingReference }),
      ...(row.meta && { meta: row.meta }),
    }));
    await this.movements.create(docs, { session, ordered: true });
  }

  /** A booking's automatic ledger row: written once even when a webhook or the sweep repeats. */
  private async recordBookingMovement(row: MovementInput): Promise<boolean> {
    try {
      await this.recordMovements([row]);
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  // --------------------------------------------------------------------- hooks

  /** Newly paid / confirmed bookings: ledger row per booking, then refresh the products' flags. Never throws. */
  async onBookingsConfirmed(bookings: BookingStockFacts[], now = new Date()): Promise<void> {
    try {
      const refs: ProductRef[] = [];
      for (const booking of bookings) {
        const key = bookingStockKey(booking);
        if (!key) continue;
        refs.push({ productType: key.productType, productRef: key.productRef });
        const available = await this.availableOn(key, key.day, now);
        await this.recordBookingMovement({
          key,
          title: booking.title ?? key.productRef,
          type: 'booking_confirmed',
          date: key.day,
          before: available === null ? null : available + booking.quantity,
          after: available,
          delta: -booking.quantity,
          reason: 'Booking confirmed',
          bookingReference: booking.reference,
        });
      }
      await this.refreshProducts(refs, now);
    } catch (error) {
      this.logger.warn(`Stock update after confirmation failed: ${(error as Error).message}`);
    }
  }

  /** An unpaid order's holds were released (expired or cancelled): refresh the flags of the products involved. */
  async onOrderReleased(orderReference: string, now = new Date()): Promise<void> {
    try {
      const rows = await this.bookings
        .find({ orderReference })
        .select('activitySlug stockProductType stockProductRef serviceDay optionId stockVariantId')
        .lean()
        .exec();
      const refs = rows.flatMap((row) => {
        const key = bookingStockKey({ ...row, reference: '', status: '', quantity: 0 });
        return key ? [{ productType: key.productType, productRef: key.productRef }] : [];
      });
      await this.refreshProducts(refs, now);
    } catch (error) {
      this.logger.warn(`Stock update after releasing an order failed: ${(error as Error).message}`);
    }
  }

  /** The products of these bookings had stock-relevant changes (hold released, date moved): refresh their flags. Never throws. */
  async refreshBookings(bookings: BookingStockFacts[], now = new Date()): Promise<void> {
    const refs = bookings.flatMap((booking) => {
      const key = bookingStockKey(booking);
      return key ? [{ productType: key.productType, productRef: key.productRef }] : [];
    });
    await this.refreshProducts(refs, now);
  }

  /** Cutoff for returning a cancelled booking's units: policy override, else the option's cutoffHours, else 24 hours. */
  async decideRestock(booking: BookingStockFacts, now = new Date()): Promise<RestockDecision | null> {
    const key = bookingStockKey(booking);
    if (!key) return null;
    const policy = await this.policies.findOne({ productType: key.productType, productRef: key.productRef, variantId: key.variantId }).lean<StockPolicy>().exec();
    let cutoffHours: number | null = policy?.restockCutoffHours ?? null;
    if (cutoffHours === null && key.productType === 'activity') {
      const activity = await this.activities
        .findOne({ slug: key.productRef }, { options: { $elemMatch: { id: key.variantId } } })
        .lean()
        .exec();
      cutoffHours = activity?.options?.[0]?.cutoffHours ?? null;
    }
    return restockDecision({ now, serviceDay: key.day, startTime: booking.startTime, cutoffHours });
  }

  /**
   * What to do with a booking's units when it is cancelled or fully refunded: `null` when it never held any (unpaid,
   * no stock identity, or already decided). `stockReleased` is the value to store on the booking.
   */
  async cancellationPlan(booking: BookingStockFacts, now = new Date()): Promise<{ stockReleased: boolean; decision: RestockDecision } | null> {
    if (!SOLD_STATUSES.includes(booking.status as BookingStatus) || booking.stockReleased !== undefined) return null;
    const decision = await this.decideRestock(booking, now);
    return decision ? { stockReleased: decision.restock, decision } : null;
  }

  /** Writes the ledger for a cancellation (and the automatic restock), then refreshes the flags. Never throws. */
  async afterCancellation(
    booking: BookingStockFacts,
    plan: { stockReleased: boolean; decision: RestockDecision },
    actor: { id: string; email: string },
    now = new Date(),
  ): Promise<void> {
    try {
      const key = bookingStockKey(booking);
      if (!key) return;
      const title = booking.title ?? key.productRef;
      const available = await this.availableOn(key, key.day, now);
      const meta = { restocked: plan.stockReleased, cutoffAt: plan.decision.cutoffAt.toISOString() };
      await this.recordBookingMovement({
        actor,
        key,
        title,
        type: 'booking_cancelled',
        date: key.day,
        before: available === null ? null : available - (plan.stockReleased ? booking.quantity : 0),
        after: available === null ? null : available - (plan.stockReleased ? booking.quantity : 0),
        delta: 0,
        reason: plan.stockReleased ? 'Cancelled before the cutoff' : 'Cancelled after the cutoff: units stay used',
        bookingReference: booking.reference,
        meta,
      });
      if (plan.stockReleased) {
        await this.recordBookingMovement({
          actor,
          key,
          title,
          type: 'restock_auto',
          date: key.day,
          before: available === null ? null : available - booking.quantity,
          after: available,
          delta: booking.quantity,
          reason: 'Returned to stock automatically',
          bookingReference: booking.reference,
          meta,
        });
      }
      await this.refreshProducts([{ productType: key.productType, productRef: key.productRef }], now);
    } catch (error) {
      this.logger.warn(`Stock update after cancellation failed: ${(error as Error).message}`);
    }
  }

  // ------------------------------------------------------------------- refresh

  /** Namespaces of the public cache that show these products. */
  cacheNamespaces(types: Iterable<string>): string[] {
    return [...new Set([...types].filter(isCatalogType).map((type) => CACHE_NAMESPACE[type]))];
  }

  async invalidateCaches(types: Iterable<string>): Promise<void> {
    const namespaces = this.cacheNamespaces(types);
    if (namespaces.length) await this.cache.invalidate(...namespaces);
  }

  /**
   * Recomputes `stockStatus` of the given products (writing only what changed), invalidates the public caches of the
   * products that changed and sends alerts for new low / sold-out dates. Never throws (stock hooks must not fail a
   * booking). `refs` = null refreshes everything (the sweep).
   */
  async refreshProducts(refs: ProductRef[] | null, now = new Date()): Promise<void> {
    this.touch();
    try {
      const unique = refs
        ? [...new Map(refs.map((r) => [`${r.productType}|${r.productRef}`, { productType: r.productType, productRef: r.productRef }])).values()]
        : null;
      if (unique && unique.length === 0) return;
      const { ctx, products } = await this.snapshots(unique, now);
      await this.writeStatuses(products, now);
      await this.processAlerts(products, ctx, unique);
    } catch (error) {
      this.logger.warn(`Stock refresh failed: ${(error as Error).message}`);
    }
  }

  private async writeStatuses(products: ProductSnapshot[], now: Date): Promise<void> {
    const changedTypes = new Set<string>();
    const byType = new Map<CatalogProductType, { updateOne: { filter: object; update: object } }[]>();
    for (const product of products) {
      if (!product.source.docId || !isCatalogType(product.source.productType)) continue;
      const status = combineVariants(product.variants.map((v) => v.horizon));
      if (sameStockStatus(product.source.currentStatus, status)) continue;
      const ops = byType.get(product.source.productType) ?? [];
      ops.push({
        updateOne: { filter: { _id: product.source.docId }, update: { $set: { stockStatus: { ...status, checkedAt: now } } } },
      });
      byType.set(product.source.productType, ops);
      changedTypes.add(product.source.productType);
    }
    const models: Record<CatalogProductType, Model<any>> = {
      activity: this.activities,
      holiday: this.holidays,
      cruise: this.cruises,
      event: this.events,
    };
    for (const [type, ops] of byType) {
      // timestamps: false keeps `updatedAt` meaning "an editor changed this".
      await models[type].bulkWrite(ops, { timestamps: false });
    }
    if (changedTypes.size) await this.invalidateCaches(changedTypes);
  }

  // -------------------------------------------------------------------- alerts

  private async processAlerts(products: ProductSnapshot[], ctx: StockContext, refs: ProductRef[] | null): Promise<void> {
    const scope = refs?.length ? { $or: refs.map((r) => ({ productType: r.productType, productRef: r.productRef })) } : {};
    const existing = await this.alertStates.find(scope).lean<StockAlertState[]>().exec();
    const existingByItem = new Map<string, Set<string>>();
    for (const row of existing) {
      const key = itemKeyString(row);
      const set = existingByItem.get(key) ?? new Set<string>();
      set.add(alertKey(row.date, row.state));
      existingByItem.set(key, set);
    }

    const fresh: { variant: VariantSnapshot; candidate: AlertCandidate; available: number | null }[] = [];
    for (const product of products) {
      for (const variant of product.variants) {
        const key = itemKeyString(variant.source);
        const { create, remove } = diffAlerts(existingByItem.get(key) ?? new Set(), variant.alerts, ctx.today);
        if (remove.length) {
          await this.alertStates
            .deleteMany({
              productType: variant.source.productType,
              productRef: variant.source.productRef,
              variantId: variant.source.variantId,
              $or: remove.map((entry) => {
                const [date, state] = entry.split('|');
                return { date, state };
              }),
            } as any)
            .exec();
        }
        if (!create.length) continue;
        const days = new Map(this.evaluate(variant.source, ctx, ctx.today, WINDOW_DAYS).map((d) => [d.date, d]));
        for (const candidate of create) {
          const inserted = await this.claimAlert(variant.source, candidate);
          if (inserted) fresh.push({ variant, candidate, available: days.get(candidate.date)?.available ?? null });
        }
      }
    }
    // Alert rows of dates that passed (or items that no longer exist) are dropped on a full sweep.
    if (!refs) await this.alertStates.deleteMany({ date: { $lt: ctx.today } }).exec();

    if (!fresh.length) return;
    await this.recordMovements(
      fresh.map(({ variant, candidate, available }) => ({
        key: variant.source,
        title: `${variant.source.title}${variant.source.variantLabel ? ` - ${variant.source.variantLabel}` : ''}`,
        type: candidate.state === 'sold_out' ? ('alert_sold_out' as const) : ('alert_low' as const),
        date: candidate.date,
        before: null,
        after: available,
        delta: null,
        reason: candidate.state === 'sold_out' ? 'Sold out' : 'Low stock',
      })),
    );
    await this.sendAlertEmail(fresh);
  }

  /** True when this call created the alert record (so it is the one that alerts). */
  private async claimAlert(key: ItemKey, candidate: AlertCandidate): Promise<boolean> {
    try {
      await this.alertStates.create({ ...key, date: candidate.date, state: candidate.state, alertedAt: new Date() });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  async alertRecipients(): Promise<string[]> {
    const valid = (value: string) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value);
    const fromEnv = (this.config.get<string>('STOCK_ALERT_EMAILS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(valid);
    if (fromEnv.length) return fromEnv;
    try {
      const general = await this.settings.get('general');
      const support = typeof general.supportEmail === 'string' ? general.supportEmail.trim() : '';
      return valid(support) ? [support] : [];
    } catch {
      return [];
    }
  }

  private async sendAlertEmail(
    fresh: { variant: VariantSnapshot; candidate: AlertCandidate; available: number | null }[],
  ): Promise<void> {
    try {
      const recipients = await this.alertRecipients();
      if (!recipients.length) return;
      const soldOut = fresh.filter((f) => f.candidate.state === 'sold_out').length;
      const low = fresh.length - soldOut;
      const label = (f: (typeof fresh)[number]) =>
        `${f.candidate.state === 'sold_out' ? 'SOLD OUT' : `LOW (${f.available ?? '?'} left)`}: ${f.variant.source.title}${
          f.variant.source.variantLabel ? ` - ${f.variant.source.variantLabel}` : ''
        } on ${f.candidate.date}`;
      const lines = fresh.slice(0, MAX_ALERT_LINES).map(label);
      if (fresh.length > MAX_ALERT_LINES) lines.push(`...and ${fresh.length - MAX_ALERT_LINES} more (see Inventory > Low stock & sold out)`);
      await this.notifications.stockAlert({
        recipients,
        subject: `Stock alert: ${soldOut} sold out, ${low} running low`,
        lines,
      });
    } catch (error) {
      this.logger.warn(`Stock alert e-mail failed: ${(error as Error).message}`);
    }
  }

  // --------------------------------------------------------------------- sweep

  /** Periodic refresh of every product: dates roll over, holds expire, alert records of passed days are dropped. */
  async sweep(now = new Date()): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.refreshProducts(null, now);
    } finally {
      this.sweeping = false;
    }
  }

  // ----------------------------------------------------------------- public API

  publicStock(status?: Partial<ProductStockStatus> | null) {
    return publicStock(status);
  }

  /** Stable id helper re-exported for callers that already hold a service instance. */
  itemId(key: ItemKey): string {
    return formatItemId(key);
  }
}
