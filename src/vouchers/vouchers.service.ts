import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as QRCode from 'qrcode';
import { QueryFilter, Model, Types } from 'mongoose';
import { Booking } from '../bookings/schemas/booking.schema';
import { operatingToday } from '../catalog/activity-booking.utils';
import { appError } from '../common/app-error';
import {
  buildPagination,
  escapeRegex,
  parseSort,
  skipFor,
} from '../common/query/paging-query.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { ListVouchersDto } from './vouchers.dto';
import {
  evaluateVoucher,
  formatVoucherCode,
  generateVoucherCode,
  normalizeVoucherCode,
  voucherUrl,
  type VoucherVerdict,
} from './voucher-code';
import { Voucher } from './voucher.schema';

export interface StaffActor {
  id: string;
  name: string;
  email?: string;
}

const VOUCHER_SORTS = ['issuedAt', 'redeemedAt', 'status'] as const;

export interface QrImage {
  /** Encoded text: the voucher URL. */
  text: string;
  /** Module grid size; the SVG viewBox is 0 0 size size. */
  size: number;
  /** One SVG path of all dark modules (fill it with currentColor). */
  path: string;
}

/** Turns the QR matrix into a single SVG path (rendered by the clients without innerHTML). */
export function qrPath(size: number, isDark: (x: number, y: number) => boolean): string {
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!isDark(x, y)) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < size && isDark(x + run, y)) run++;
      parts.push(`M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join('');
}

@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);
  private readonly siteUrl: string;

  constructor(
    @InjectModel(Voucher.name) private readonly vouchers: Model<Voucher>,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.siteUrl = (config.get<string>('FRONTEND_URL', 'http://localhost:3000') ?? '').split(',')[0].trim();
  }

  urlFor(code: string): string {
    return voucherUrl(this.siteUrl, code);
  }

  qrFor(code: string): QrImage {
    const text = this.urlFor(code);
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    return { text, size, path: qrPath(size, (x, y) => qr.modules.get(x, y) === 1) };
  }

  /**
   * Issues the booking's voucher. Idempotent: the unique bookingId index makes a second call (or a
   * concurrent confirmation) return the existing voucher. Never throws into the payment flow.
   */
  async issueForBooking(booking: { _id: Types.ObjectId; reference: string }): Promise<Voucher | null> {
    try {
      const existing = await this.vouchers.findOne({ bookingId: booking._id }).lean().exec();
      if (existing) return existing;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const created = await this.vouchers.create({
            code: generateVoucherCode(),
            bookingId: booking._id,
            bookingReference: booking.reference,
            status: 'issued',
            issuedAt: new Date(),
          });
          await this.pushEvent(booking._id, 'voucher_issued', undefined, 'Voucher issued');
          return created.toObject();
        } catch (error) {
          if ((error as { code?: number }).code !== 11000) throw error;
          const raced = await this.vouchers.findOne({ bookingId: booking._id }).lean().exec();
          if (raced) return raced; // same booking issued concurrently; otherwise a code collision, retry
        }
      }
      throw new Error('could not allocate a unique voucher code');
    } catch (error) {
      this.logger.error(`Voucher issue failed for ${booking.reference}: ${(error as Error).message}`);
      return null;
    }
  }

  findByBooking(bookingId: string | Types.ObjectId) {
    return this.vouchers.findOne({ bookingId: new Types.ObjectId(bookingId) }).lean().exec();
  }

  /** Customer/staff view of one voucher including its QR (no personal data in the QR itself). */
  toView(voucher: Voucher) {
    return {
      id: voucher._id.toString(),
      code: voucher.code,
      displayCode: formatVoucherCode(voucher.code),
      url: this.urlFor(voucher.code),
      qr: this.qrFor(voucher.code),
      bookingId: voucher.bookingId.toString(),
      bookingReference: voucher.bookingReference,
      status: voucher.status,
      issuedAt: voucher.issuedAt,
      redeemedAt: voucher.redeemedAt ?? null,
      redeemedByName: voucher.redeemedByName ?? null,
      voidedAt: voucher.voidedAt ?? null,
      voidReason: voucher.voidReason ?? null,
      resendCount: voucher.resendCount ?? 0,
      lastSentAt: voucher.lastSentAt ?? null,
    };
  }

  async list(query: ListVouchersDto) {
    const filter: QueryFilter<Voucher> = {};
    if (query.status) filter.status = query.status;
    if (query.redeemedFrom || query.redeemedTo) {
      filter.redeemedAt = {
        ...(query.redeemedFrom && { $gte: new Date(query.redeemedFrom) }),
        ...(query.redeemedTo && { $lte: new Date(query.redeemedTo) }),
      };
    }
    if (query.redeemedBy) filter.redeemedBy = new Types.ObjectId(query.redeemedBy);

    // Filters that live on the booking resolve to booking ids first.
    const bookingFilter: QueryFilter<Booking> = {};
    if (query.activity) bookingFilter.activitySlug = query.activity;
    if (query.serviceFrom || query.serviceTo) {
      bookingFilter.serviceDay = {
        ...(query.serviceFrom && { $gte: query.serviceFrom }),
        ...(query.serviceTo && { $lte: query.serviceTo }),
      };
    }
    const q = query.q?.trim();
    if (q) {
      const code = normalizeVoucherCode(q);
      const pattern = new RegExp(escapeRegex(q), 'i');
      const matched = await this.bookings
        .find({
          $or: [
            { reference: pattern },
            { 'customer.fullName': pattern },
            { 'customer.email': pattern },
            { title: pattern },
          ],
        })
        .select('_id')
        .limit(300)
        .lean()
        .exec();
      const or: QueryFilter<Voucher>[] = [{ bookingId: { $in: matched.map((b) => b._id) } }];
      if (code) or.push({ code });
      filter.$or = or;
    }
    if (Object.keys(bookingFilter).length) {
      const ids = await this.bookings.find(bookingFilter).select('_id').limit(5000).lean().exec();
      filter.bookingId = { $in: ids.map((b) => b._id) };
    }

    const sort = parseSort(query.sort, VOUCHER_SORTS, { field: 'issuedAt', dir: -1 });
    const [rows, total] = await Promise.all([
      this.vouchers.find(filter).sort(sort).skip(skipFor(query.page, query.limit)).limit(query.limit).lean().exec(),
      this.vouchers.countDocuments(filter).exec(),
    ]);
    const bookings = await this.bookings
      .find({ _id: { $in: rows.map((v) => v.bookingId) } })
      .select(
        'reference title optionName serviceDay serviceDate startTime adults children quantity status customer activitySlug',
      )
      .lean()
      .exec();
    const byId = new Map(bookings.map((b) => [b._id.toString(), b]));
    return {
      items: rows.map((voucher) => {
        const booking = byId.get(voucher.bookingId.toString());
        return {
          id: voucher._id.toString(),
          code: voucher.code,
          displayCode: formatVoucherCode(voucher.code),
          status: voucher.status,
          issuedAt: voucher.issuedAt,
          redeemedAt: voucher.redeemedAt ?? null,
          redeemedByName: voucher.redeemedByName ?? null,
          bookingId: voucher.bookingId.toString(),
          bookingReference: voucher.bookingReference,
          bookingStatus: booking?.status ?? null,
          activityTitle: booking?.title ?? null,
          optionName: booking?.optionName ?? null,
          serviceDay: booking?.serviceDay ?? null,
          startTime: booking?.startTime ?? null,
          travellers: booking ? (booking.adults ?? booking.quantity) + (booking.children ?? 0) : null,
          customerName: booking?.customer?.fullName ?? null,
          customerEmail: booking?.customer?.email ?? null,
        };
      }),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }

  async getView(id: string) {
    const voucher = await this.vouchers.findById(id).lean().exec();
    if (!voucher) throw appError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
    const booking = await this.bookings.findById(voucher.bookingId).lean().exec();
    return { ...this.toView(voucher), booking: booking ? this.bookingSummary(booking) : null };
  }

  /** Void is final: a void voucher can never be redeemed. Repeating it is a no-op. */
  async voidVoucher(id: string, actor: StaffActor, reason: string) {
    const voucher = await this.vouchers.findOneAndUpdate(
      { _id: id, status: 'issued' },
      { $set: { status: 'void', voidedAt: new Date(), voidedBy: new Types.ObjectId(actor.id), voidReason: reason } },
      { returnDocument: 'after' },
    ).lean().exec();
    if (!voucher) {
      const current = await this.vouchers.findById(id).lean().exec();
      if (!current) throw appError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
      if (current.status === 'void') return this.toView(current);
      throw appError(409, 'ALREADY_REDEEMED', 'A redeemed voucher cannot be voided');
    }
    await this.pushEvent(voucher.bookingId, 'voucher_voided', actor, reason);
    return this.toView(voucher);
  }

  /** Voids an issued voucher because its booking was cancelled/refunded. Redeemed ones stay as they are. */
  async voidForBooking(bookingId: string | Types.ObjectId, reason: string, actor?: StaffActor) {
    const voucher = await this.vouchers
      .findOneAndUpdate(
        { bookingId: new Types.ObjectId(bookingId), status: 'issued' },
        {
          $set: {
            status: 'void',
            voidedAt: new Date(),
            voidReason: reason,
            ...(actor && { voidedBy: new Types.ObjectId(actor.id) }),
          },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (voucher) await this.pushEvent(voucher.bookingId, 'voucher_voided', actor, reason);
    return voucher;
  }

  async resend(id: string, actor: StaffActor) {
    const voucher = await this.vouchers.findById(id).lean().exec();
    if (!voucher) throw appError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
    if (voucher.status !== 'issued') {
      throw appError(409, 'VOUCHER_NOT_ISSUED', `A ${voucher.status} voucher cannot be resent`);
    }
    const updated = await this.vouchers
      .findOneAndUpdate(
        { _id: id, status: 'issued' },
        { $inc: { resendCount: 1 }, $set: { lastSentAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (!updated) throw appError(409, 'VOUCHER_NOT_ISSUED', 'The voucher is no longer issued');
    await this.notifications.bookingConfirmed({ bookingReference: updated.bookingReference });
    await this.pushEvent(updated.bookingId, 'voucher_resent', actor, 'Voucher sent again');
    return this.toView(updated);
  }

  /** Staff scan step 1: look the code up and say whether it can be redeemed right now. */
  async validate(rawCode: string, now = new Date()) {
    const code = normalizeVoucherCode(rawCode);
    if (!code) throw appError(400, 'INVALID_CODE', 'That is not a valid voucher code');
    const voucher = await this.vouchers.findOne({ code }).lean().exec();
    if (!voucher) throw appError(404, 'VOUCHER_NOT_FOUND', 'No voucher matches this code');
    const booking = await this.bookings.findById(voucher.bookingId).lean().exec();
    const verdict = this.verdictFor(voucher, booking, now);
    return {
      verdict,
      ok: verdict === 'valid',
      voucher: {
        id: voucher._id.toString(),
        displayCode: formatVoucherCode(voucher.code),
        status: voucher.status,
        redeemedAt: voucher.redeemedAt ?? null,
        redeemedByName: voucher.redeemedByName ?? null,
        voidReason: voucher.voidReason ?? null,
      },
      booking: booking ? this.bookingSummary(booking) : null,
      today: operatingToday(now),
    };
  }

  /**
   * Staff scan step 2. Atomic: only an `issued` voucher flips to `redeemed`, so two simultaneous
   * scans cannot both succeed; the loser gets 409 ALREADY_REDEEMED with the original redemption time.
   */
  async redeem(id: string, actor: StaffActor, now = new Date()) {
    const voucher = await this.vouchers.findById(id).lean().exec();
    if (!voucher) throw appError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
    const booking = await this.bookings.findById(voucher.bookingId).lean().exec();
    const verdict = this.verdictFor(voucher, booking, now);
    if (verdict !== 'valid') throw this.refusal(verdict, voucher, booking);

    const redeemed = await this.vouchers
      .findOneAndUpdate(
        { _id: id, status: 'issued' },
        {
          $set: {
            status: 'redeemed',
            redeemedAt: now,
            redeemedBy: new Types.ObjectId(actor.id),
            redeemedByName: actor.name,
          },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (!redeemed) {
      const current = await this.vouchers.findById(id).lean().exec();
      throw this.refusal(evaluateVoucherStatus(current), current ?? voucher, booking);
    }
    return { ...this.toView(redeemed), booking: booking ? this.bookingSummary(booking) : null };
  }

  /** Public, rate-limited lookup behind the QR URL: minimal, non-personal validity info only. */
  async publicLookup(rawCode: string, now = new Date()) {
    const code = normalizeVoucherCode(rawCode);
    const voucher = code ? await this.vouchers.findOne({ code }).lean().exec() : null;
    if (!voucher) throw appError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found');
    const booking = await this.bookings
      .findById(voucher.bookingId)
      .select('title optionName serviceDay startTime adults children quantity status')
      .lean()
      .exec();
    const verdict = this.verdictFor(voucher, booking, now);
    return {
      status: verdict,
      valid: verdict === 'valid',
      activityTitle: booking?.title ?? null,
      optionName: booking?.optionName ?? null,
      serviceDay: booking?.serviceDay ?? null,
      startTime: booking?.startTime ?? null,
      adults: booking ? (booking.adults ?? booking.quantity) : null,
      children: booking?.children ?? 0,
      redeemedAt: voucher.status === 'redeemed' ? (voucher.redeemedAt ?? null) : null,
    };
  }

  private verdictFor(
    voucher: Pick<Voucher, 'status'>,
    booking: Pick<Booking, 'status' | 'serviceDay'> | null,
    now: Date,
  ): VoucherVerdict {
    return evaluateVoucher(
      {
        status: voucher.status,
        serviceDay: booking?.serviceDay,
        bookingStatus: booking?.status ?? 'unknown',
      },
      operatingToday(now),
    );
  }

  private refusal(verdict: VoucherVerdict, voucher: Voucher, booking: Booking | null) {
    const day = booking?.serviceDay ?? '';
    switch (verdict) {
      case 'already_redeemed':
        return appError(
          409,
          'ALREADY_REDEEMED',
          `Already redeemed at ${voucher.redeemedAt ? new Date(voucher.redeemedAt).toISOString() : 'an earlier scan'}`,
        );
      case 'void':
        return appError(409, 'VOUCHER_VOID', 'This voucher was voided');
      case 'too_early':
        return appError(409, 'TOO_EARLY', `This voucher is only valid on ${day}`);
      case 'expired':
        return appError(409, 'VOUCHER_EXPIRED', `This voucher was only valid on ${day}`);
      default:
        return appError(409, 'BOOKING_INACTIVE', 'The booking behind this voucher is not confirmed');
    }
  }

  private bookingSummary(booking: Booking) {
    return {
      id: booking._id.toString(),
      reference: booking.reference,
      status: booking.status,
      activityTitle: booking.title,
      optionName: booking.optionName ?? null,
      serviceDay: booking.serviceDay ?? null,
      startTime: booking.startTime ?? null,
      adults: booking.adults ?? booking.quantity,
      children: booking.children ?? 0,
      travellers: (booking.adults ?? booking.quantity) + (booking.children ?? 0),
      leadTraveller: booking.customer?.fullName ?? null,
      pickup:
        booking.pickup?.mode === 'now'
          ? [booking.pickup.locationName, booking.pickup.address].filter(Boolean).join(', ')
          : null,
    };
  }

  private async pushEvent(
    bookingId: Types.ObjectId,
    type: 'voucher_issued' | 'voucher_voided' | 'voucher_resent',
    actor: StaffActor | undefined,
    text: string,
  ) {
    try {
      await this.bookings
        .updateOne(
          { _id: bookingId },
          {
            $push: {
              events: {
                type,
                at: new Date(),
                ...(actor && { actorId: new Types.ObjectId(actor.id), actorName: actor.name }),
                text: text.slice(0, 500),
              },
            },
          },
        )
        .exec();
    } catch (error) {
      this.logger.warn(`Could not record ${type} event: ${(error as Error).message}`);
    }
  }
}

function evaluateVoucherStatus(voucher: Pick<Voucher, 'status'> | null): VoucherVerdict {
  if (!voucher) return 'void';
  return voucher.status === 'redeemed' ? 'already_redeemed' : voucher.status === 'void' ? 'void' : 'booking_inactive';
}
