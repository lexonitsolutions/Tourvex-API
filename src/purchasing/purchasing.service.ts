import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import { Model, Types } from 'mongoose';
import { addDays, isValidIsoDate, operatingToday } from '../catalog/activity-booking.utils';
import { appError, appErrorWith } from '../common/app-error';
import { TransactionService } from '../common/database/transaction.service';
import { buildPagination, escapeRegex, skipFor } from '../common/query/paging-query.dto';
import { Counter } from '../crm/billing/schemas/counter.schema';
import { BASE_CURRENCY } from '../currency/currency.constants';
import { StockAdminService, type StockActor } from '../stock/stock-admin.service';
import { StockService, type VariantSource } from '../stock/stock.service';
import { formatItemId, parseItemId, type ItemKey } from '../stock/stock.types';
import {
  CreatePurchaseDto,
  CreateSupplierDto,
  ListPurchasesDto,
  ListSuppliersDto,
  MarkPaidDto,
  PurchaseLineDto,
  UpdatePurchaseDto,
  UpdateSupplierDto,
} from './dto/purchasing.dto';
import { Purchase, PurchaseLine } from './schemas/purchase.schema';
import { Supplier } from './schemas/supplier.schema';
import {
  computeLine,
  computeTotals,
  dueDateFor,
  formatPurchaseNumber,
  fromMinor,
  lastUnitCosts,
  purchaseCounterName,
  toMinor,
} from './purchasing.rules';

type PurchaseLean = Purchase & { _id: Types.ObjectId };
type SupplierLean = Supplier & { _id: Types.ObjectId };

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const REGEX_LIMIT = 100;

export interface PurchaseOutcome {
  purchase: ReturnType<PurchasingService['toPurchase']>;
  /** False when the call was a repeat (already received / void / paid): nothing was changed. */
  changed: boolean;
}

const rangeMessages: Record<string, string> = {
  INVALID_DATE: 'dateFrom and dateTo must be valid YYYY-MM-DD dates',
  INVALID_RANGE: 'dateTo cannot be before dateFrom',
  RANGE_TOO_LARGE: 'A line can cover at most 93 days',
  NO_MATCHING_DAYS: 'No date in the line range falls on the selected weekdays',
};

/** Suppliers and stock purchases. Receiving / voiding applies stock through the Phase 1 engine in one transaction. */
@Injectable()
export class PurchasingService {
  private readonly logger = new Logger(PurchasingService.name);

  constructor(
    @InjectModel(Supplier.name) private readonly suppliers: Model<Supplier>,
    @InjectModel(Purchase.name) private readonly purchases: Model<Purchase>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    private readonly stock: StockService,
    private readonly stockAdmin: StockAdminService,
    private readonly transactions: TransactionService,
  ) {}

  // ------------------------------------------------------------------- views

  toSupplier(doc: SupplierLean) {
    return {
      id: doc._id.toString(),
      name: doc.name,
      legalName: doc.legalName ?? '',
      country: doc.country,
      registrationNumber: doc.registrationNumber ?? '',
      email: doc.email ?? '',
      phone: doc.phone ?? '',
      address: doc.address ?? '',
      paymentTermsDays: doc.paymentTermsDays ?? 0,
      currency: doc.currency,
      notes: doc.notes ?? '',
      active: doc.active,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private toLine(line: PurchaseLine) {
    return {
      itemId: line.itemId,
      title: line.title,
      variantLabel: line.variantLabel,
      quantity: line.quantity,
      dateFrom: line.dateFrom,
      dateTo: line.dateTo,
      ...(line.weekdays?.length && { weekdays: line.weekdays }),
      totalUnits: line.totalUnits,
      unitCost: line.unitCost,
      ...(line.taxPercent !== undefined && line.taxPercent !== null && { taxPercent: line.taxPercent }),
      lineTotal: line.lineTotal,
    };
  }

  /** `PurchaseRow` of the list. */
  toRow(doc: PurchaseLean) {
    return {
      id: doc._id.toString(),
      number: doc.number,
      supplierId: doc.supplierId.toString(),
      supplierName: doc.supplierName,
      supplierInvoiceNumber: doc.supplierInvoiceNumber ?? '',
      invoiceDate: doc.invoiceDate,
      dueDate: doc.dueDate ?? null,
      currency: doc.currency,
      lineCount: doc.lines.length,
      totalUnits: doc.lines.reduce((sum, line) => sum + line.totalUnits, 0),
      subtotal: doc.subtotal,
      taxTotal: doc.taxTotal,
      total: doc.total,
      status: doc.status,
      receivedAt: doc.receivedAt ?? null,
      paidAt: doc.paidAt ?? null,
      createdAt: doc.createdAt,
    };
  }

  /** The full purchase. */
  toPurchase(doc: PurchaseLean) {
    return {
      ...this.toRow(doc),
      lines: doc.lines.map((line) => this.toLine(line)),
      paymentReference: doc.paymentReference ?? null,
      voidedAt: doc.voidedAt ?? null,
      notes: doc.notes ?? '',
      createdBy: doc.createdBy ?? '',
      updatedAt: doc.updatedAt,
    };
  }

  // ---------------------------------------------------------------- suppliers

  private supplierNotFound() {
    return appError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  }

  private duplicateSupplier() {
    return appError(409, 'SUPPLIER_EXISTS', 'A supplier with this name already exists');
  }

  async listSuppliers(query: ListSuppliersDto) {
    const filter: Record<string, unknown> = {};
    if (query.active !== undefined) filter.active = query.active;
    const q = query.q?.trim().slice(0, REGEX_LIMIT);
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: pattern }, { legalName: pattern }, { email: pattern }, { registrationNumber: pattern }];
    }
    const [rows, total] = await Promise.all([
      this.suppliers.find(filter).sort({ nameKey: 1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean<SupplierLean[]>().exec(),
      this.suppliers.countDocuments(filter).exec(),
    ]);
    return { items: rows.map((row) => this.toSupplier(row)), pagination: buildPagination(query.page, query.limit, total) };
  }

  private async loadSupplier(id: string): Promise<SupplierLean> {
    if (!OBJECT_ID.test(id)) throw this.supplierNotFound();
    const doc = await this.suppliers.findById(id).lean<SupplierLean>().exec();
    if (!doc) throw this.supplierNotFound();
    return doc;
  }

  async getSupplier(id: string) {
    return this.toSupplier(await this.loadSupplier(id));
  }

  async createSupplier(dto: CreateSupplierDto) {
    try {
      const created = await this.suppliers.create({ ...dto, nameKey: dto.name.toLowerCase() });
      return this.toSupplier(created.toObject());
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw this.duplicateSupplier();
      throw error;
    }
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    const before = this.toSupplier(await this.loadSupplier(id));
    const set: Record<string, unknown> = { ...dto };
    if (dto.name !== undefined) set.nameKey = dto.name.toLowerCase();
    let doc: SupplierLean | null;
    try {
      doc = await this.suppliers.findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after', runValidators: true }).lean<SupplierLean>().exec();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw this.duplicateSupplier();
      throw error;
    }
    if (!doc) throw this.supplierNotFound();
    return { before, after: this.toSupplier(doc) };
  }

  /** 409 `SUPPLIER_IN_USE` when any purchase refers to the supplier: deactivate it instead. */
  async deleteSupplier(id: string) {
    const supplier = await this.loadSupplier(id);
    if (await this.purchases.exists({ supplierId: supplier._id }).exec()) {
      throw appError(409, 'SUPPLIER_IN_USE', 'This supplier has purchases and cannot be deleted. Deactivate it instead');
    }
    await this.suppliers.deleteOne({ _id: supplier._id }).exec();
    return this.toSupplier(supplier);
  }

  // ---------------------------------------------------------------- purchases

  private purchaseNotFound() {
    return appError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  }

  private duplicateInvoice() {
    return appError(409, 'DUPLICATE_SUPPLIER_INVOICE', 'This supplier invoice number was already recorded for this supplier');
  }

  private async loadPurchase(id: string, session?: ClientSession): Promise<PurchaseLean> {
    if (!OBJECT_ID.test(id)) throw this.purchaseNotFound();
    const doc = await this.purchases.findById(id).session(session ?? null).lean<PurchaseLean>().exec();
    if (!doc) throw this.purchaseNotFound();
    return doc;
  }

  async getPurchase(id: string) {
    return this.toPurchase(await this.loadPurchase(id));
  }

  /** `GET /purchases`: totals count and add up the matching purchases, void ones only when `status=void` is asked for. */
  async listPurchases(query: ListPurchasesDto) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.supplierId) filter.supplierId = new Types.ObjectId(query.supplierId);
    if (query.from || query.to) filter.invoiceDate = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
    const q = query.q?.trim().slice(0, REGEX_LIMIT);
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ number: pattern }, { supplierName: pattern }, { supplierInvoiceNumber: pattern }];
    }
    const totalsFilter = query.status ? filter : { ...filter, status: { $ne: 'void' } };
    const [rows, total, sums] = await Promise.all([
      this.purchases
        .find(filter)
        .sort({ invoiceDate: -1, createdAt: -1, _id: -1 })
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<PurchaseLean[]>()
        .exec(),
      this.purchases.countDocuments(filter).exec(),
      this.purchases.aggregate([{ $match: totalsFilter }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } }]).exec(),
    ]);
    return {
      items: rows.map((row) => this.toRow(row)),
      pagination: buildPagination(query.page, query.limit, total),
      totals: { count: sums[0]?.count ?? 0, total: fromMinor(toMinor(sums[0]?.total ?? 0)) },
    };
  }

  /** `GET /summary`. */
  async summary(now = new Date()) {
    const today = operatingToday(now);
    const [draftCount, unpaid, overdueCount, recent] = await Promise.all([
      this.purchases.countDocuments({ status: 'draft' }).exec(),
      this.purchases.aggregate([{ $match: { status: 'received' } }, { $group: { _id: null, total: { $sum: '$total' } } }]).exec(),
      this.purchases.countDocuments({ status: 'received', dueDate: { $lt: today } }).exec(),
      this.purchases
        .aggregate([
          { $match: { status: { $in: ['received', 'paid'] }, invoiceDate: { $gte: addDays(today, -29), $lte: today } } },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ])
        .exec(),
    ]);
    return {
      draftCount,
      receivedUnpaidTotal: fromMinor(toMinor(unpaid[0]?.total ?? 0)),
      overdueCount,
      last30DaysTotal: fromMinor(toMinor(recent[0]?.total ?? 0)),
    };
  }

  private rangeError(error: unknown): never {
    const code = (error as { code?: string }).code;
    if (code && rangeMessages[code]) throw appError(400, code, rangeMessages[code]);
    throw error;
  }

  private checkCurrency(currency: string | undefined) {
    if (currency && currency !== BASE_CURRENCY) {
      throw appError(400, 'CURRENCY_NOT_SUPPORTED', `Purchases are recorded in ${BASE_CURRENCY} only`);
    }
  }

  /** Validates the lines against the stock items and the calendar, and fills in the derived figures. */
  private async prepareLines(input: PurchaseLineDto[], now: Date): Promise<PurchaseLine[]> {
    const today = operatingToday(now);
    const variants = new Map<string, VariantSource>();
    const lines: PurchaseLine[] = [];
    for (const [index, line] of input.entries()) {
      const key = parseItemId(line.itemId);
      if (!key) throw appError(400, 'INVALID_ITEM_ID', `Line ${index + 1}: item id must look like productType:productRef:variantId`);
      const itemId = formatItemId(key);
      let variant = variants.get(itemId);
      if (!variant) {
        variant = (await this.stock.loadVariant(key)) ?? undefined;
        if (!variant) throw appError(404, 'ITEM_NOT_FOUND', `Line ${index + 1}: stock item ${itemId} not found`);
        variants.set(itemId, variant);
      }
      let figures: ReturnType<typeof computeLine>;
      try {
        figures = computeLine(line);
      } catch (error) {
        this.rangeError(error);
      }
      if (line.dateFrom < today) throw appError(400, 'PAST_DATE', `Line ${index + 1}: stock cannot be added to dates in the past`);
      lines.push({
        itemId,
        title: variant.title,
        variantLabel: variant.variantLabel,
        quantity: line.quantity,
        dateFrom: line.dateFrom,
        dateTo: line.dateTo,
        ...(line.weekdays?.length && { weekdays: [...line.weekdays].sort((a, b) => a - b) }),
        totalUnits: figures.totalUnits,
        unitCost: line.unitCost,
        ...(line.taxPercent !== undefined && { taxPercent: line.taxPercent }),
        lineTotal: figures.lineTotal,
      });
    }
    return lines;
  }

  private totalsOf(lines: PurchaseLine[]) {
    return computeTotals(lines.map((line) => ({ lineTotal: line.lineTotal, taxAmount: computeLine(line).taxAmount })));
  }

  /** The gap-free counter row must exist before the transaction (creating it inside would race on the unique key). */
  private async ensureCounter(name: string): Promise<void> {
    try {
      await this.counters.updateOne({ _id: name }, { $setOnInsert: { seq: 0 } }, { upsert: true }).exec();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }

  /** `POST /purchases`: a draft. The number is taken inside the same transaction as the insert, so it never leaves a gap. */
  async createPurchase(dto: CreatePurchaseDto, actor: StockActor, now = new Date()) {
    this.checkCurrency(dto.currency);
    if (!isValidIsoDate(dto.invoiceDate)) throw appError(400, 'INVALID_DATE', 'invoiceDate must be a valid YYYY-MM-DD date');
    if (dto.dueDate && !isValidIsoDate(dto.dueDate)) throw appError(400, 'INVALID_DATE', 'dueDate must be a valid YYYY-MM-DD date');
    const supplier = await this.loadSupplier(dto.supplierId);
    if (!supplier.active) throw appError(409, 'SUPPLIER_INACTIVE', 'This supplier is inactive');
    const lines = await this.prepareLines(dto.lines, now);
    const totals = this.totalsOf(lines);
    const dueDate = dto.dueDate || dueDateFor(dto.invoiceDate, supplier.paymentTermsDays ?? 0);
    const year = operatingToday(now).slice(0, 4);
    const counter = purchaseCounterName(year);
    await this.ensureCounter(counter);

    try {
      const created = await this.transactions.run(async (session) => {
        const next = await this.counters.findOneAndUpdate({ _id: counter }, { $inc: { seq: 1 } }, { returnDocument: 'after', session }).lean().exec();
        const [doc] = await this.purchases.create(
          [
            {
              number: formatPurchaseNumber(year, next!.seq),
              supplierId: supplier._id,
              supplierName: supplier.name,
              ...(dto.supplierInvoiceNumber && { supplierInvoiceNumber: dto.supplierInvoiceNumber }),
              invoiceDate: dto.invoiceDate,
              ...(dueDate && { dueDate }),
              currency: BASE_CURRENCY,
              lines,
              ...totals,
              status: 'draft',
              notes: dto.notes ?? '',
              createdBy: actor.email,
            },
          ],
          { session },
        );
        return doc.toObject();
      });
      return this.toPurchase(created);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw this.duplicateInvoice();
      throw error;
    }
  }

  /** `PATCH /purchases/:id`: drafts only. Returns the purchase before and after for the audit entry. */
  async updatePurchase(id: string, dto: UpdatePurchaseDto, now = new Date()) {
    const current = await this.loadPurchase(id);
    // Received and paid purchases accept a notes-only edit; everything else is frozen (void purchases are read-only).
    const notesOnly = Object.entries(dto).every(([field, value]) => field === 'notes' || value === undefined);
    const editable = current.status === 'draft' || (notesOnly && (current.status === 'received' || current.status === 'paid'));
    if (!editable) throw appError(409, 'NOT_EDITABLE', 'Only a draft purchase can be edited (received and paid purchases accept a notes-only change)');
    this.checkCurrency(dto.currency);
    if (dto.invoiceDate && !isValidIsoDate(dto.invoiceDate)) throw appError(400, 'INVALID_DATE', 'invoiceDate must be a valid YYYY-MM-DD date');
    if (dto.dueDate && !isValidIsoDate(dto.dueDate)) throw appError(400, 'INVALID_DATE', 'dueDate must be a valid YYYY-MM-DD date');

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (dto.supplierId !== undefined && dto.supplierId !== current.supplierId.toString()) {
      const supplier = await this.loadSupplier(dto.supplierId);
      if (!supplier.active) throw appError(409, 'SUPPLIER_INACTIVE', 'This supplier is inactive');
      set.supplierId = supplier._id;
      set.supplierName = supplier.name;
    }
    if (dto.supplierInvoiceNumber !== undefined) {
      if (dto.supplierInvoiceNumber) set.supplierInvoiceNumber = dto.supplierInvoiceNumber;
      else unset.supplierInvoiceNumber = 1;
    }
    if (dto.invoiceDate !== undefined) set.invoiceDate = dto.invoiceDate;
    if (dto.dueDate !== undefined) {
      if (dto.dueDate) set.dueDate = dto.dueDate;
      else unset.dueDate = 1;
    }
    if (dto.notes !== undefined) set.notes = dto.notes;
    if (dto.lines) {
      const lines = await this.prepareLines(dto.lines, now);
      Object.assign(set, { lines }, this.totalsOf(lines));
    }

    let doc: PurchaseLean | null;
    try {
      doc = await this.purchases
        .findOneAndUpdate(
          { _id: current._id, status: current.status },
          { ...(Object.keys(set).length && { $set: set }), ...(Object.keys(unset).length && { $unset: unset }) },
          { returnDocument: 'after' },
        )
        .lean<PurchaseLean>()
        .exec();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw this.duplicateInvoice();
      throw error;
    }
    if (!doc) throw appError(409, 'NOT_EDITABLE', 'The purchase changed state; reload it');
    return { before: this.toPurchase(current), after: this.toPurchase(doc) };
  }

  // ------------------------------------------------------- receive / void / paid

  /** Dates of a stored line (already validated when it was saved). */
  private expand(line: PurchaseLine) {
    return computeLine(line).dates;
  }

  private async variantOf(line: PurchaseLine): Promise<{ key: ItemKey; variant: VariantSource }> {
    const key = parseItemId(line.itemId)!;
    const variant = await this.stock.loadVariant(key);
    if (!variant) throw appError(404, 'ITEM_NOT_FOUND', `Stock item ${line.itemId} no longer exists`);
    return { key, variant };
  }

  /** Make sure rows exist that the transaction would otherwise create concurrently (capacity locks, item policies). */
  private async prepareStock(lines: PurchaseLine[], withPolicies: boolean): Promise<Array<{ line: PurchaseLine; key: ItemKey; variant: VariantSource; dates: string[] }>> {
    const prepared = [];
    for (const line of lines) {
      const { key, variant } = await this.variantOf(line);
      prepared.push({ line, key, variant, dates: this.expand(line) });
    }
    await this.stock.ensureLocks(prepared.flatMap((p) => p.dates.map((day) => ({ ...p.key, day }))));
    if (withPolicies) {
      for (const { key, variant } of new Map(prepared.map((p) => [formatItemId(p.key), p])).values()) {
        try {
          await this.stock.policies
            .updateOne(key, { $setOnInsert: { title: variant.title, variantLabel: variant.variantLabel, active: true } }, { upsert: true })
            .exec();
        } catch (error) {
          if ((error as { code?: number }).code !== 11000) throw error;
        }
      }
    }
    return prepared;
  }

  private async refreshStock(lines: PurchaseLine[], now: Date) {
    const refs = new Map<string, { productType: ItemKey['productType']; productRef: string }>();
    for (const line of lines) {
      const key = parseItemId(line.itemId);
      if (key) refs.set(`${key.productType}|${key.productRef}`, { productType: key.productType, productRef: key.productRef });
    }
    try {
      await this.stock.refreshProducts([...refs.values()], now);
    } catch (error) {
      // The purchase is committed; the 5-minute stock sweep repairs the flags and caches.
      this.logger.error(`Stock refresh after purchase failed: ${String(error)}`);
    }
  }

  /**
   * `POST /purchases/:id/receive`: in ONE transaction adds each line's units to every date through the stock engine,
   * writes the ledger rows, records the last unit cost on the item and marks the purchase received. Repeating it (or a
   * concurrent second call) changes nothing and returns the purchase again.
   */
  async receive(id: string, actor: StockActor, now = new Date()): Promise<PurchaseOutcome> {
    const current = await this.loadPurchase(id);
    if (current.status === 'received' || current.status === 'paid') return { purchase: this.toPurchase(current), changed: false };
    if (current.status === 'void') throw appError(409, 'NOT_RECEIVABLE', 'A void purchase cannot be received');
    const today = operatingToday(now);
    if (current.lines.some((line) => line.dateFrom < today)) {
      throw appError(400, 'PAST_DATE', 'A line starts in the past. Edit the draft so every date is today or later');
    }
    const prepared = await this.prepareStock(current.lines, true);

    const outcome = await this.transactions.run(async (session) => {
      const claimed = await this.purchases
        .findOneAndUpdate(
          { _id: current._id, status: 'draft' },
          { $set: { status: 'received', receivedAt: now } },
          { returnDocument: 'after', session },
        )
        .lean<PurchaseLean>()
        .exec();
      if (!claimed) {
        const fresh = await this.loadPurchase(id, session);
        if (fresh.status === 'received' || fresh.status === 'paid') return { purchase: fresh, changed: false };
        throw appError(409, 'NOT_RECEIVABLE', 'This purchase can no longer be received');
      }
      const meta = { purchaseNumber: claimed.number, purchaseId: claimed._id.toString() };
      for (const { line, key, variant, dates } of prepared) {
        await this.stockAdmin.applyDaysInSession(
          session,
          key,
          variant,
          { from: line.dateFrom, to: line.dateTo, weekdays: line.weekdays, mode: 'add', capacity: line.quantity, reason: `Purchase ${claimed.number}` },
          dates,
          actor,
          now,
          meta,
        );
      }
      for (const [itemId, unitCost] of lastUnitCosts(claimed.lines)) {
        const { key, variant } = prepared.find((p) => formatItemId(p.key) === itemId)!;
        const policy = await this.stock.policies.findOne(key).session(session).lean().exec();
        await this.stock.policies.updateOne(key, { $set: { unitCost } }, { session }).exec();
        await this.stock.recordMovements(
          [
            {
              actor,
              key,
              title: variant.variantLabel ? `${variant.title} - ${variant.variantLabel}` : variant.title,
              type: 'set_cost',
              reason: `Purchase ${claimed.number}: unit cost set to ${unitCost}`,
              meta: { ...meta, unitCost, previousUnitCost: policy?.unitCost ?? null },
            },
          ],
          session,
        );
      }
      return { purchase: claimed, changed: true };
    });

    if (outcome.changed) await this.refreshStock(current.lines, now);
    return { purchase: this.toPurchase(outcome.purchase), changed: outcome.changed };
  }

  /**
   * `POST /purchases/:id/void`: draft or received. A received purchase gives its units back (the same stock edit in
   * reverse) unless that would drop a date below its committed units (409 `STOCK_BELOW_COMMITTED`, nothing changes).
   */
  async voidPurchase(id: string, actor: StockActor, now = new Date()): Promise<PurchaseOutcome> {
    const current = await this.loadPurchase(id);
    if (current.status === 'void') return { purchase: this.toPurchase(current), changed: false };
    if (current.status === 'paid') throw appError(409, 'NOT_VOIDABLE', 'A paid purchase cannot be voided');
    const prepared = current.status === 'received' ? await this.prepareStock(current.lines, false) : [];

    const outcome = await this.transactions.run(async (session) => {
      const before = await this.purchases
        .findOneAndUpdate(
          { _id: current._id, status: { $in: ['draft', 'received'] } },
          { $set: { status: 'void', voidedAt: now } },
          { returnDocument: 'before', session },
        )
        .lean<PurchaseLean>()
        .exec();
      if (!before) {
        const fresh = await this.loadPurchase(id, session);
        if (fresh.status === 'void') return { purchase: fresh, changed: false, restocked: false };
        throw appError(409, 'NOT_VOIDABLE', 'A paid purchase cannot be voided');
      }
      if (before.status === 'received') {
        const meta = { purchaseNumber: before.number, purchaseId: before._id.toString(), voided: true };
        // Same stock edit as the receive, reversed; one remove per line (a locked date below its committed units aborts all).
        for (const { line, key, variant, dates } of [...prepared].reverse()) {
          await this.stockAdmin.applyDaysInSession(
            session,
            key,
            variant,
            { from: line.dateFrom, to: line.dateTo, weekdays: line.weekdays, mode: 'remove', capacity: line.quantity, reason: `Purchase ${before.number} voided` },
            dates,
            actor,
            now,
            meta,
          );
        }
      }
      return { purchase: { ...before, status: 'void' as const, voidedAt: now }, changed: true, restocked: before.status === 'received' };
    });

    if (outcome.restocked) await this.refreshStock(current.lines, now);
    return { purchase: this.toPurchase(outcome.purchase), changed: outcome.changed };
  }

  /** `POST /purchases/:id/mark-paid`: only from `received`; a repeat on a paid purchase is a no-op. */
  async markPaid(id: string, dto: MarkPaidDto, now = new Date()): Promise<PurchaseOutcome> {
    const current = await this.loadPurchase(id);
    if (current.status === 'paid') return { purchase: this.toPurchase(current), changed: false };
    if (current.status !== 'received') throw appError(409, 'NOT_PAYABLE', 'Only a received purchase can be marked as paid');
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : now;
    const updated = await this.purchases
      .findOneAndUpdate(
        { _id: current._id, status: 'received' },
        { $set: { status: 'paid', paidAt, ...(dto.reference && { paymentReference: dto.reference }) } },
        { returnDocument: 'after' },
      )
      .lean<PurchaseLean>()
      .exec();
    if (!updated) {
      const fresh = await this.loadPurchase(id);
      if (fresh.status === 'paid') return { purchase: this.toPurchase(fresh), changed: false };
      throw appErrorWith(409, 'NOT_PAYABLE', 'Only a received purchase can be marked as paid', { status: fresh.status });
    }
    return { purchase: this.toPurchase(updated), changed: true };
  }
}
