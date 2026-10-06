import { appError } from '../common/app-error';
import { BookingStatus } from './schemas/booking.schema';

/**
 * Pure business rules for staff actions on bookings (no I/O, unit tested). Money is handled in
 * integer minor units (fils) so partial refunds never drift.
 */

export const toMinorUnits = (amount: number): number => Math.round(amount * 100 + Math.sign(amount) * 1e-7);
export const fromMinorUnits = (minor: number): number => minor / 100;

export type BookingAction =
  | 'confirm'
  | 'cancel'
  | 'approve_cancellation'
  | 'reject_cancellation'
  | 'refund'
  | 'resend'
  | 'edit_date';

/** Which statuses each action may start from. `refund` additionally needs a recorded payment. */
const ALLOWED_FROM: Record<BookingAction, readonly BookingStatus[]> = {
  confirm: [BookingStatus.PendingPayment],
  cancel: [BookingStatus.PendingPayment, BookingStatus.Confirmed, BookingStatus.CancellationRequested],
  approve_cancellation: [BookingStatus.CancellationRequested],
  reject_cancellation: [BookingStatus.CancellationRequested],
  refund: [BookingStatus.Confirmed, BookingStatus.CancellationRequested, BookingStatus.Cancelled],
  resend: [BookingStatus.Confirmed],
  edit_date: [BookingStatus.Confirmed],
};

export interface BookingFacts {
  status: BookingStatus;
  total: number;
  refundedAmount?: number | null;
  /** Set once a payment was recorded (confirmation). */
  confirmedAt?: Date | null;
  refundable?: boolean | null;
  freeCancellationUntil?: Date | null;
  activitySlug?: string | null;
  holdExpiresAt?: Date | null;
}

export function canPerform(action: BookingAction, booking: BookingFacts): boolean {
  if (!ALLOWED_FROM[action].includes(booking.status)) return false;
  if (action === 'refund') return Boolean(booking.confirmedAt) && refundableMinor(booking) > 0;
  if (action === 'edit_date') return Boolean(booking.activitySlug);
  return true;
}

/** Throws 409 INVALID_STATUS when the action cannot start from the booking's current status. */
export function assertCanPerform(action: BookingAction, booking: BookingFacts): void {
  if (!ALLOWED_FROM[action].includes(booking.status)) {
    throw appError(
      409,
      'INVALID_STATUS',
      `A ${booking.status.replace(/_/g, ' ')} booking cannot be ${verbOf(action)}`,
    );
  }
  if (action === 'refund') {
    if (!booking.confirmedAt) {
      throw appError(409, 'NOT_PAID', 'This booking has no recorded payment, so there is nothing to refund');
    }
    if (refundableMinor(booking) <= 0) {
      throw appError(409, 'ALREADY_REFUNDED', 'This booking has already been refunded in full');
    }
  }
  if (action === 'edit_date' && !booking.activitySlug) {
    throw appError(409, 'NOT_SUPPORTED', 'Only activity bookings support changing the service date');
  }
}

function verbOf(action: BookingAction): string {
  switch (action) {
    case 'confirm':
      return 'confirmed';
    case 'cancel':
    case 'approve_cancellation':
      return 'cancelled';
    case 'reject_cancellation':
      return 'have its cancellation request rejected';
    case 'refund':
      return 'refunded';
    case 'resend':
      return 'resent a confirmation';
    case 'edit_date':
      return 'moved to another date';
  }
}

/** What is still refundable, in minor units. */
export function refundableMinor(booking: Pick<BookingFacts, 'total' | 'refundedAmount'>): number {
  return Math.max(0, toMinorUnits(booking.total) - toMinorUnits(booking.refundedAmount ?? 0));
}

/** Validates a refund amount against what is left. Throws 400/409 with a stable code. */
export function assertRefundAmount(booking: BookingFacts, amount: number): number {
  const minor = toMinorUnits(amount);
  if (!Number.isFinite(amount) || minor <= 0) {
    throw appError(400, 'INVALID_AMOUNT', 'The refund amount must be greater than zero');
  }
  const remaining = refundableMinor(booking);
  if (minor > remaining) {
    throw appError(
      409,
      'REFUND_EXCEEDS_PAID',
      `The refund cannot exceed what is still refundable (${fromMinorUnits(remaining).toFixed(2)})`,
    );
  }
  return minor;
}

/** Status after `refundedMinor` has been refunded in total: fully refunded bookings become `refunded`. */
export function statusAfterRefund(
  current: BookingStatus,
  totalMinor: number,
  refundedMinor: number,
): BookingStatus {
  return refundedMinor >= totalMinor ? BookingStatus.Refunded : current;
}

export interface CancellationPolicyResult {
  /** The free-cancellation window is still open (or the booking is refundable without a deadline). */
  eligible: boolean;
  /** Refund the policy grants, in AED. */
  refundAmount: number;
  reason: string;
}

/**
 * Refund a cancellation earns under the booking's own policy: the full remaining paid amount while
 * `freeCancellationUntil` has not passed, nothing afterwards (or for non-refundable bookings).
 */
export function cancellationPolicy(booking: BookingFacts, now: Date): CancellationPolicyResult {
  if (!booking.confirmedAt) {
    return { eligible: false, refundAmount: 0, reason: 'Nothing was paid for this booking' };
  }
  if (!booking.refundable) {
    return { eligible: false, refundAmount: 0, reason: 'Non-refundable booking' };
  }
  if (!booking.freeCancellationUntil) {
    return { eligible: false, refundAmount: 0, reason: 'No free-cancellation window on this booking' };
  }
  if (now.getTime() > new Date(booking.freeCancellationUntil).getTime()) {
    return { eligible: false, refundAmount: 0, reason: 'The free-cancellation deadline has passed' };
  }
  return {
    eligible: true,
    refundAmount: fromMinorUnits(refundableMinor(booking)),
    reason: 'Cancelled before the free-cancellation deadline',
  };
}

export type RefundChoice = 'policy' | 'full' | 'none' | 'custom';

/** Resolves the refund (AED) a cancellation should carry. */
export function resolveCancellationRefund(
  booking: BookingFacts,
  choice: RefundChoice,
  customAmount: number | undefined,
  now: Date,
): number {
  switch (choice) {
    case 'none':
      return 0;
    case 'policy':
      return cancellationPolicy(booking, now).refundAmount;
    case 'full':
      return booking.confirmedAt ? fromMinorUnits(refundableMinor(booking)) : 0;
    case 'custom': {
      if (customAmount === undefined) {
        throw appError(400, 'INVALID_AMOUNT', 'refundAmount is required for a custom refund');
      }
      if (!booking.confirmedAt) {
        throw appError(409, 'NOT_PAID', 'This booking has no recorded payment, so there is nothing to refund');
      }
      assertRefundAmount(booking, customAmount);
      return customAmount;
    }
  }
}

export type PaymentStatus = 'unpaid' | 'paid' | 'partially_refunded' | 'refunded';

export function paymentStatusOf(booking: BookingFacts): PaymentStatus {
  const refunded = toMinorUnits(booking.refundedAmount ?? 0);
  if (!booking.confirmedAt) return 'unpaid';
  if (refunded <= 0) return 'paid';
  return refunded >= toMinorUnits(booking.total) ? 'refunded' : 'partially_refunded';
}

/** True when `date` (YYYY-MM-DD) is a valid change target relative to today (never in the past). */
export function isFutureOrToday(date: string, today: string): boolean {
  return date >= today;
}
