import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { listItem } from '../admin-bookings/booking-view';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { addDays, operatingToday } from '../catalog/activity-booking.utils';
import { TransactionService } from '../common/database/transaction.service';
import { appError, appErrorWith } from '../common/app-error';
import { buildPagination, escapeRegex, skipFor } from '../common/query/paging-query.dto';
import {
  CreateStockItemDto,
  ItemDaysQueryDto,
  ListMovementsDto,
  ListStockItemsDto,
  UpdateStockDaysDto,
  UpdateStockItemDto,
} from './dto/stock.dto';
import { StockPolicy } from './schemas/stock-policy.schema';
import { applyCapacityEdit, effectiveCapacity, expandDates, type DayFigures } from './stock.rules';
import {
  StockService,
  bookingStockKey,
  type MovementInput,
  type ProductRef,
  type StockContext,
  type VariantSnapshot,
  type VariantSource,
} from './stock.service';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  MAX_RANGE_DAYS,
  RANGED_LEDGER_SUMMARY_DAYS,
  WINDOW_DAYS,
  formatItemId,
  itemKeyString,
  parseItemId,
  type ItemKey,
  type ItemStatus,
} from './stock.types';

/** What a per-date capacity edit needs (`PUT /items/:id/days` body and the purchasing receive / void). */
export type DayEdit = Pick<UpdateStockDaysDto, 'from' | 'to' | 'weekdays' | 'mode' | 'capacity' | 'closed' | 'note' | 'reason'>;

export interface StockActor {
  id: string;
  email: string;
}

/** `Item` of the contract. */
export interface StockItemView {
  id: string;
  productType: string;
  productRef: string;
  variantId: string;
  title: string;
  variantLabel: string;
  defaultCapacity: number | null;
  /** The limit that applies when no policy default is saved (the activity option's own daily capacity), else null. */
  inheritedCapacity: number | null;
  /** Where the effective default comes from: a saved policy, the product's own setup, or no limit. */
  capacitySource: 'policy' | 'legacy' | 'unlimited';
  lowStockThreshold: number;
  stopSale: boolean;
  unitCost: number | null;
  windowFrom: string;
  windowTo: string;
  capacityTotal: number | null;
  soldTotal: number;
  heldTotal: number;
  availableTotal: number | null;
  lowestRemaining: number | null;
  nextSoldOutDate: string | null;
  status: ItemStatus;
  hasPolicy: boolean;
  updatedAt: string | null;
}

const STATUS_RANK: Record<ItemStatus, number> = { sold_out: 0, low: 1, closed: 2, ok: 3, unlimited: 4 };

/** Worst first: sold out, low (fewest left first), closed, ok, unlimited; then by title. */
export function compareAttention(a: StockItemView, b: StockItemView): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    (a.lowestRemaining ?? Number.MAX_SAFE_INTEGER) - (b.lowestRemaining ?? Number.MAX_SAFE_INTEGER) ||
    a.title.localeCompare(b.title) ||
    a.variantLabel.localeCompare(b.variantLabel)
  );
}

const nullsLast = (value: number | null) => value ?? Number.MAX_SAFE_INTEGER;

const SORTERS: Record<NonNullable<ListStockItemsDto['sort']>, (a: StockItemView, b: StockItemView) => number> = {
  attention: compareAttention,
  title: (a, b) => a.title.localeCompare(b.title) || a.variantLabel.localeCompare(b.variantLabel),
  type: (a, b) => a.productType.localeCompare(b.productType) || a.title.localeCompare(b.title) || a.variantLabel.localeCompare(b.variantLabel),
  available: (a, b) => nullsLast(a.availableTotal) - nullsLast(b.availableTotal) || a.title.localeCompare(b.title),
};

const OBJECT_OR_REFERENCE = /^([a-f0-9]{24}|TVX-\d{4}-[A-Z0-9]{8})$/i;

@Injectable()
export class StockAdminService {
  constructor(
    private readonly stock: StockService,
    private readonly transactions: TransactionService,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
  ) {}

  // ------------------------------------------------------------------ helpers

  toItem(variant: VariantSnapshot, today: string): StockItemView {
    const policy = variant.policy;
    return {
      id: formatItemId(variant.source),
      productType: variant.source.productType,
      productRef: variant.source.productRef,
      variantId: variant.source.variantId,
      title: variant.source.title,
      variantLabel: variant.source.variantLabel,
      defaultCapacity: policy?.defaultCapacity ?? null,
      inheritedCapacity: variant.source.legacyCapacity ?? null,
      capacitySource: policy?.defaultCapacity != null ? 'policy' : variant.source.legacyCapacity != null ? 'legacy' : 'unlimited',
      lowStockThreshold: policy?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
      stopSale: policy?.stopSale ?? false,
      unitCost: policy?.unitCost ?? null,
      windowFrom: today,
      windowTo: addDays(today, WINDOW_DAYS - 1),
      capacityTotal: variant.window.capacityTotal,
      soldTotal: variant.window.soldTotal,
      heldTotal: variant.window.heldTotal,
      availableTotal: variant.window.availableTotal,
      lowestRemaining: variant.window.lowestRemaining,
      nextSoldOutDate: variant.window.nextSoldOutDate,
      status: variant.window.status,
      hasPolicy: Boolean(policy),
      updatedAt: policy?.updatedAt ? new Date(policy.updatedAt).toISOString() : null,
    };
  }

  private async allItems(now: Date): Promise<StockItemView[]> {
    const { ctx, products } = await this.stock.allSnapshots(now);
    return products.flatMap((product) => product.variants.map((variant) => this.toItem(variant, ctx.today)));
  }

  private parse(id: string): ItemKey {
    const key = parseItemId(id);
    if (!key) throw appError(400, 'INVALID_ITEM_ID', 'Item id must look like productType:productRef:variantId');
    return key;
  }

  private async requireVariant(key: ItemKey): Promise<VariantSource> {
    const variant = await this.stock.loadVariant(key);
    if (!variant) throw appError(404, 'ITEM_NOT_FOUND', 'Stock item not found');
    return variant;
  }

  /** The fresh view of one item (single product load, not the shared admin memo). */
  private async itemView(key: ItemKey, now = new Date()): Promise<StockItemView> {
    const { ctx, products } = await this.stock.snapshots([{ productType: key.productType, productRef: key.productRef }], now);
    const variant = products.flatMap((p) => p.variants).find((v) => v.source.variantId === key.variantId);
    if (!variant) throw appError(404, 'ITEM_NOT_FOUND', 'Stock item not found');
    return this.toItem(variant, ctx.today);
  }

  private ref(key: ItemKey): ProductRef {
    return { productType: key.productType, productRef: key.productRef };
  }

  private rangeError(error: unknown): never {
    const code = (error as { code?: string }).code;
    const messages: Record<string, string> = {
      INVALID_DATE: 'from and to must be valid YYYY-MM-DD dates',
      INVALID_RANGE: 'to cannot be before from',
      RANGE_TOO_LARGE: `A range can cover at most ${MAX_RANGE_DAYS} days`,
      NO_MATCHING_DAYS: 'No date in the range falls on the selected weekdays',
    };
    if (code && messages[code]) throw appError(400, code, messages[code]);
    throw error;
  }

  // ------------------------------------------------------------------- reads

  /** `GET /summary`. Counts are over the next 30 days. */
  async summary(now = new Date()) {
    const items = await this.allItems(now);
    const attention = items
      .filter((item) => item.status === 'sold_out' || item.status === 'low' || item.stopSale)
      .sort(compareAttention)
      .slice(0, 8);
    return {
      lowStock: items.filter((item) => item.status === 'low').length,
      soldOut: items.filter((item) => item.status === 'sold_out').length,
      stopped: items.filter((item) => item.stopSale).length,
      attention,
      generatedAt: now.toISOString(),
    };
  }

  /** `GET /items`. */
  async listItems(query: ListStockItemsDto, now = new Date()) {
    let items = await this.allItems(now);
    if (query.type) items = items.filter((item) => item.productType === query.type);
    if (query.status) items = items.filter((item) => item.status === query.status);
    const q = query.q?.trim();
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      items = items.filter((item) => pattern.test(item.title) || pattern.test(item.productRef) || pattern.test(item.variantLabel) || pattern.test(item.variantId));
    }
    items.sort(SORTERS[query.sort ?? 'attention']);
    const total = items.length;
    const start = skipFor(query.page, query.limit);
    return { items: items.slice(start, start + query.limit), pagination: buildPagination(query.page, query.limit, total) };
  }

  /** The days of one item in [from, to]; defaults to the current month. */
  async days(variant: VariantSource, from: string, to: string, now: Date): Promise<{ ctx: StockContext; days: DayFigures[] }> {
    const ctx = await this.stock.loadContext([this.ref(variant)], now, WINDOW_DAYS, { from, to });
    const count = dayCount(from, to);
    return { ctx, days: this.stock.evaluate(variant, ctx, from, count) };
  }

  /** `GET /items/:id?from=&to=`. */
  async getItem(id: string, query: ItemDaysQueryDto, now = new Date()) {
    const key = this.parse(id);
    const variant = await this.requireVariant(key);
    const today = operatingToday(now);
    const monthStart = `${today.slice(0, 8)}01`;
    const from = query.from ?? monthStart;
    const to = query.to ?? lastDayOfMonth(from);
    try {
      expandDates(from, to);
    } catch (error) {
      this.rangeError(error);
    }
    const { days } = await this.days(variant, from, to, now);
    return { item: await this.itemView(key, now), days };
  }

  /** `GET /movements`. */
  async listMovements(query: ListMovementsDto) {
    const filter: Record<string, unknown> = {};
    if (query.itemId) {
      const key = this.parse(query.itemId);
      Object.assign(filter, { productType: key.productType, productRef: key.productRef, variantId: key.variantId });
    }
    if (query.type) filter.type = query.type;
    if (query.actor) {
      filter.$or = /^[a-f0-9]{24}$/i.test(query.actor)
        ? [{ actorId: new Types.ObjectId(query.actor) }]
        : [{ actorEmail: new RegExp(escapeRegex(query.actor), 'i') }];
    }
    if (query.purchaseNumber) {
      const byPurchase = { $or: [{ 'meta.purchaseNumber': query.purchaseNumber }, { reason: new RegExp(`^Purchase ${escapeRegex(query.purchaseNumber)}`) }] };
      filter.$and = [byPurchase];
    }
    if (query.from || query.to) {
      filter.at = {
        ...(query.from && { $gte: new Date(`${query.from}T00:00:00.000+04:00`) }),
        ...(query.to && { $lt: new Date(new Date(`${query.to}T00:00:00.000+04:00`).getTime() + 86_400_000) }),
      };
    }
    const [rows, total] = await Promise.all([
      this.stock.movements
        .find(filter)
        .sort({ at: -1, _id: -1 })
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean()
        .exec(),
      this.stock.movements.countDocuments(filter).exec(),
    ]);
    return {
      items: rows.map((row) => ({
        id: row._id.toString(),
        at: row.at,
        actorId: row.actorId?.toString() ?? null,
        actorEmail: row.actorEmail,
        productType: row.productType,
        productRef: row.productRef,
        variantId: row.variantId,
        itemId: formatItemId(row),
        title: row.title,
        type: row.type,
        date: row.date ?? null,
        before: row.before ?? null,
        after: row.after ?? null,
        delta: row.delta ?? null,
        reason: row.reason ?? '',
        bookingReference: row.bookingReference ?? null,
        meta: row.meta ?? null,
      })),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }

  // ----------------------------------------------------------------- mutations

  /** `PATCH /items/:id`. Returns the item plus the audit before/after. */
  async updateItem(id: string, dto: UpdateStockItemDto, actor: StockActor, now = new Date()) {
    const key = this.parse(id);
    const variant = await this.requireVariant(key);
    const today = operatingToday(now);
    const horizonEnd = addDays(today, 365);
    const before = await this.itemView(key, now);

    // Lock every day that already has bookings, so no checkout can slip in while capacity is lowered.
    if (dto.defaultCapacity !== undefined) {
      const usage = (await this.stock.loadUsage([key], today, horizonEnd, now)).get(itemKeyString(key));
      await this.stock.ensureLocks([...(usage?.keys() ?? [])].map((day) => ({ ...key, day })));
    }

    await this.transactions.run(async (session) => {
      const rows: MovementInput[] = [];
      const policy = await this.stock.policies.findOne(key).session(session).lean<StockPolicy>().exec();

      if (dto.defaultCapacity !== undefined) {
        const next = dto.defaultCapacity;
        const fallbackLimit = typeof next === 'number' ? next : variant.legacyCapacity;
        if (fallbackLimit !== null) {
          const usage = (await this.stock.loadUsage([key], today, horizonEnd, now, { session })).get(itemKeyString(key));
          if (usage?.size) {
            await this.stock.lock([...usage.keys()].map((day) => ({ ...key, day })), session);
            const overrides = await this.stock.dayDocs
              .find({ ...key, date: { $gte: today, $lte: horizonEnd }, capacity: { $ne: null } })
              .session(session)
              .select('date')
              .lean()
              .exec();
            const covered = new Set(overrides.map((o) => o.date));
            for (const date of [...usage.keys()].sort()) {
              const cell = usage.get(date)!;
              if (!covered.has(date) && cell.sold + cell.held > fallbackLimit) {
                throw appErrorWith(
                  409,
                  'STOCK_BELOW_COMMITTED',
                  `${cell.sold + cell.held} units are already committed on ${date}, more than the new capacity of ${fallbackLimit}`,
                  { date, committed: cell.sold + cell.held, capacity: fallbackLimit },
                );
              }
            }
          }
        }
        const oldDefault = policy?.defaultCapacity ?? variant.legacyCapacity;
        if ((policy?.defaultCapacity ?? null) !== next) {
          rows.push({
            actor,
            key,
            title: itemTitle(variant),
            type: 'set_default',
            before: oldDefault,
            after: next,
            delta: typeof next === 'number' && typeof oldDefault === 'number' ? next - oldDefault : null,
            reason: dto.reason ?? '',
          });
        }
      }
      if (dto.stopSale !== undefined && dto.stopSale !== (policy?.stopSale ?? false)) {
        rows.push({ actor, key, title: itemTitle(variant), type: dto.stopSale ? 'stop_sale' : 'resume_sale', reason: dto.reason ?? '' });
      }

      const set: Record<string, unknown> = {};
      if (dto.defaultCapacity !== undefined) set.defaultCapacity = dto.defaultCapacity;
      if (dto.lowStockThreshold !== undefined) set.lowStockThreshold = dto.lowStockThreshold;
      if (dto.stopSale !== undefined) set.stopSale = dto.stopSale;
      if (dto.unitCost !== undefined) set.unitCost = dto.unitCost;
      await this.stock.policies
        .findOneAndUpdate(
          key,
          {
            ...(Object.keys(set).length && { $set: set }),
            $setOnInsert: { title: variant.title, variantLabel: variant.variantLabel, active: true },
          },
          { upsert: true, session, setDefaultsOnInsert: true },
        )
        .exec();
      await this.stock.recordMovements(rows, session);
    });

    await this.stock.refreshProducts([this.ref(key)], now);
    const after = await this.itemView(key, now);
    return { before, after };
  }

  /** `PUT /items/:id/days`. */
  async updateDays(id: string, dto: UpdateStockDaysDto, actor: StockActor, now = new Date()) {
    const key = this.parse(id);
    const variant = await this.requireVariant(key);
    const today = operatingToday(now);

    let dates: string[];
    try {
      dates = expandDates(dto.from, dto.to, dto.weekdays);
    } catch (error) {
      this.rangeError(error);
    }
    if (dto.from < today) throw appError(400, 'PAST_DATE', 'Stock cannot be changed for dates in the past');
    if (dto.mode === 'set' && dto.capacity === undefined && dto.closed === undefined && dto.note === undefined) {
      throw appError(400, 'NOTHING_TO_SET', 'Give a capacity, closed or note to set');
    }
    if ((dto.mode === 'add' || dto.mode === 'remove') && dto.capacity === undefined) {
      throw appError(400, 'CAPACITY_REQUIRED', 'capacity is required for add and remove');
    }
    if ((dto.mode === 'add' || dto.mode === 'remove') && !dto.reason) {
      throw appError(400, 'REASON_REQUIRED', 'A reason is required when adding or removing units');
    }

    await this.stock.ensureLocks(dates.map((day) => ({ ...key, day })));

    await this.transactions.run((session) => this.applyDaysInSession(session, key, variant, dto, dates, actor, now));

    await this.stock.refreshProducts([this.ref(key)], now);
    const { days } = await this.days(variant, dto.from, dto.to, now);
    return { updated: dates.length, days };
  }

  /**
   * The body of `PUT /items/:id/days`, to run INSIDE a transaction (the caller has already called `ensureLocks` for
   * these dates and validated the range). Takes the capacity locks, applies the edit to every date, writes the ledger
   * rows (`meta` is merged into each row) and throws `STOCK_BELOW_COMMITTED` when a date would drop below its
   * committed units. Purchasing reuses it so receiving or voiding a purchase is exactly an add / remove edit.
   */
  async applyDaysInSession(
    session: ClientSession,
    key: ItemKey,
    variant: VariantSource,
    dto: DayEdit,
    dates: string[],
    actor: StockActor,
    now: Date,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.stock.lock(dates.map((day) => ({ ...key, day })), session);
    const first = dates[0];
    const last = dates[dates.length - 1];
    const [infos, existing, policy] = await Promise.all([
      this.stock.capacityInfo(key, variant.legacyCapacity, first, last, now, { session }),
      this.stock.dayDocs.find({ ...key, date: { $in: dates } }).session(session).lean().exec(),
      this.stock.policies.findOne(key).session(session).lean<StockPolicy>().exec(),
    ]);
    const current = new Map(existing.map((doc) => [doc.date, doc]));
    const ops: Record<string, unknown>[] = [];
    const rows: MovementInput[] = [];
    const summarise = dates.length > RANGED_LEDGER_SUMMARY_DAYS;
    const title = itemTitle(variant);
    const capacityType = dto.mode === 'add' ? 'adjust_add' : dto.mode === 'remove' ? 'adjust_remove' : 'set_day';

    for (const date of dates) {
      const info = infos.get(date)!;
      const doc = current.get(date);
      const fallback = effectiveCapacity({ defaultCapacity: policy?.defaultCapacity ?? null, legacyCapacity: variant.legacyCapacity }).capacity;
      let capacity: number | null;
      let closed: boolean;
      let note: string;

      if (dto.mode === 'clear') {
        capacity = null;
        closed = false;
        note = '';
      } else {
        if ((dto.mode === 'add' || dto.mode === 'remove') && info.limit === null) {
          throw appError(409, 'UNLIMITED_ITEM', 'This item has no capacity set, so there is nothing to add to or remove from. Set a capacity first');
        }
        capacity =
          dto.capacity === undefined
            ? (doc?.capacity ?? null)
            : applyCapacityEdit(dto.mode, info.limit, dto.capacity);
        closed = dto.closed ?? doc?.closed ?? false;
        note = dto.note ?? doc?.note ?? '';
      }

      const newEffective = capacity ?? fallback;
      if (newEffective !== null && newEffective < info.booked) {
        throw appErrorWith(
          409,
          'STOCK_BELOW_COMMITTED',
          `${info.booked} units are already committed on ${date}, more than the new capacity of ${newEffective}`,
          { date, committed: info.booked, capacity: newEffective },
        );
      }

      const empty = capacity === null && !closed && !note;
      ops.push(
        empty
          ? { deleteOne: { filter: { ...key, date } } }
          : { updateOne: { filter: { ...key, date }, update: { $set: { capacity, closed, note } }, upsert: true } },
      );

      if (!summarise) {
        if (newEffective !== info.limit) {
          rows.push({
            actor,
            key,
            title,
            type: capacityType,
            date,
            before: info.limit,
            after: newEffective,
            delta: typeof newEffective === 'number' && typeof info.limit === 'number' ? newEffective - info.limit : null,
            reason: dto.mode === 'clear' ? dto.reason || 'Date override cleared' : (dto.reason ?? ''),
            ...(meta && { meta }),
          });
        }
        const wasClosed = doc?.closed ?? false;
        if (closed !== wasClosed) rows.push({ actor, key, title, type: closed ? 'close' : 'open', date, reason: dto.reason ?? '', ...(meta && { meta }) });
      }
    }

    if (summarise) {
      const rangeMeta = { ...meta, from: dto.from, to: dto.to, days: dates.length, mode: dto.mode, ...(dto.weekdays?.length && { weekdays: dto.weekdays }) };
      if (dto.mode === 'clear' || dto.capacity !== undefined) {
        rows.push({
          actor,
          key,
          title,
          type: capacityType,
          before: null,
          after: dto.mode === 'set' ? (dto.capacity ?? null) : null,
          delta: dto.mode === 'add' ? dto.capacity : dto.mode === 'remove' ? -(dto.capacity ?? 0) : null,
          reason: dto.reason ?? (dto.mode === 'clear' ? 'Date overrides cleared' : ''),
          meta: rangeMeta,
        });
      }
      if (dto.closed !== undefined) rows.push({ actor, key, title, type: dto.closed ? 'close' : 'open', reason: dto.reason ?? '', meta: rangeMeta });
    }

    await this.stock.dayDocs.bulkWrite(ops as any, { session });
    await this.stock.recordMovements(rows, session);
  }

  /** `POST /items`: a manual item (yacht, transfer, hotel, custom). */
  async createItem(dto: CreateStockItemDto, actor: StockActor, now = new Date()) {
    const key: ItemKey = { productType: dto.productType, productRef: dto.productRef, variantId: dto.variantId?.trim() || 'default' };
    const exists = await this.stock.policies.exists(key).exec();
    if (exists) throw appError(409, 'ITEM_EXISTS', 'A stock item with this product reference and variant already exists');
    try {
      await this.transactions.run(async (session) => {
        await this.stock.policies.create(
          [
            {
              ...key,
              title: dto.title,
              variantLabel: dto.variantLabel ?? '',
              defaultCapacity: dto.defaultCapacity,
              lowStockThreshold: dto.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
              stopSale: false,
              active: true,
            },
          ],
          { session },
        );
        await this.stock.recordMovements(
          [
            {
              actor,
              key,
              title: dto.variantLabel ? `${dto.title} - ${dto.variantLabel}` : dto.title,
              type: 'create_item',
              before: null,
              after: dto.defaultCapacity,
              delta: null,
              reason: 'Item created',
            },
          ],
          session,
        );
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw appError(409, 'ITEM_EXISTS', 'A stock item with this product reference and variant already exists');
      }
      throw error;
    }
    await this.stock.refreshProducts([this.ref(key)], now);
    return this.itemView(key, now);
  }

  /** `POST /bookings/:bookingId/return-to-stock`: staff return the kept units of a cancelled or refunded booking. */
  async returnToStock(bookingId: string, reason: string, actor: StockActor, now = new Date()) {
    if (!OBJECT_OR_REFERENCE.test(bookingId)) throw appError(400, 'INVALID_ID', 'bookingId must be a booking id or reference');
    const isId = /^[a-f0-9]{24}$/i.test(bookingId);
    const booking = await (isId ? this.bookings.findById(bookingId) : this.bookings.findOne({ reference: bookingId })).lean().exec();
    if (!booking) throw appError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (booking.stockReleased === true) throw appError(409, 'ALREADY_RETURNED', 'These units were already returned to stock');

    const returnable =
      [BookingStatus.Cancelled, BookingStatus.Refunded].includes(booking.status) && booking.stockReleased === false;
    const key = bookingStockKey(booking);
    if (!returnable || !key) {
      throw appError(409, 'NOT_RETURNABLE', 'Only a cancelled or refunded booking whose units were kept can be returned to stock');
    }

    const updated = await this.bookings
      .findOneAndUpdate({ _id: booking._id, stockReleased: false }, { $set: { stockReleased: true } }, { returnDocument: 'after' })
      .lean()
      .exec();
    if (!updated) throw appError(409, 'ALREADY_RETURNED', 'These units were already returned to stock');

    const available = await this.stock.availableOn(key, key.day, now);
    try {
      await this.stock.recordMovements([
        {
          actor,
          key,
          title: booking.title,
          type: 'restock_manual',
          date: key.day,
          before: available === null ? null : available - booking.quantity,
          after: available,
          delta: booking.quantity,
          reason,
          bookingReference: booking.reference,
        },
      ]);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    await this.stock.refreshProducts([this.ref(key)], now);
    return {
      returned: booking.quantity,
      booking: {
        ...listItem(updated, null),
        quantity: updated.quantity,
        stockProductType: key.productType,
        stockProductRef: key.productRef,
        stockVariantId: key.variantId,
        stockReleased: true,
      },
      before: { stockReleased: false },
      after: { stockReleased: true },
    };
  }
}

const itemTitle = (variant: VariantSource) => (variant.variantLabel ? `${variant.title} - ${variant.variantLabel}` : variant.title);

function dayCount(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000) + 1;
}

function lastDayOfMonth(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return `${day.slice(0, 8)}${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
}
