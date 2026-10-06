import {
  assertCanPerform,
  assertRefundAmount,
  canPerform,
  cancellationPolicy,
  paymentStatusOf,
  refundableMinor,
  resolveCancellationRefund,
  statusAfterRefund,
  type BookingFacts,
} from './booking-rules';
import { BookingStatus } from './schemas/booking.schema';

const paid = (over: Partial<BookingFacts> = {}): BookingFacts => ({
  status: BookingStatus.Confirmed,
  total: 105,
  refundedAmount: 0,
  confirmedAt: new Date('2026-10-01T10:00:00Z'),
  refundable: true,
  freeCancellationUntil: new Date('2026-10-10T10:00:00Z'),
  activitySlug: 'desert-safari',
  ...over,
});
const NOW = new Date('2026-10-05T10:00:00Z');

describe('status transitions', () => {
  it('allows each action only from its statuses', () => {
    expect(canPerform('confirm', paid({ status: BookingStatus.PendingPayment, confirmedAt: null }))).toBe(true);
    expect(canPerform('confirm', paid())).toBe(false);
    expect(canPerform('cancel', paid())).toBe(true);
    expect(canPerform('cancel', paid({ status: BookingStatus.Cancelled }))).toBe(false);
    expect(canPerform('cancel', paid({ status: BookingStatus.Expired }))).toBe(false);
    expect(canPerform('approve_cancellation', paid({ status: BookingStatus.CancellationRequested }))).toBe(true);
    expect(canPerform('approve_cancellation', paid())).toBe(false);
    expect(canPerform('reject_cancellation', paid({ status: BookingStatus.CancellationRequested }))).toBe(true);
    expect(canPerform('resend', paid({ status: BookingStatus.Cancelled }))).toBe(false);
    expect(canPerform('edit_date', paid())).toBe(true);
    expect(canPerform('edit_date', paid({ activitySlug: null }))).toBe(false);
  });

  it('reports a stable error code', () => {
    expect(() => assertCanPerform('cancel', paid({ status: BookingStatus.Refunded }))).toThrow();
    let code = '';
    try {
      assertCanPerform('confirm', paid());
    } catch (error) {
      code = (error as { getResponse(): { code: string } }).getResponse().code;
    }
    expect(code).toBe('INVALID_STATUS');
  });

  it('only refunds paid bookings with something left', () => {
    expect(canPerform('refund', paid())).toBe(true);
    expect(canPerform('refund', paid({ confirmedAt: null }))).toBe(false);
    expect(canPerform('refund', paid({ refundedAmount: 105 }))).toBe(false);
    expect(canPerform('refund', paid({ status: BookingStatus.Cancelled, refundedAmount: 50 }))).toBe(true);
  });
});

describe('refund caps', () => {
  it('computes what is left in exact minor units', () => {
    expect(refundableMinor({ total: 105, refundedAmount: 0 })).toBe(10500);
    expect(refundableMinor({ total: 105, refundedAmount: 33.3 })).toBe(7170);
    expect(refundableMinor({ total: 0.3, refundedAmount: 0.1 })).toBe(20);
  });

  it('rejects zero, negative and above-paid amounts', () => {
    expect(assertRefundAmount(paid(), 105)).toBe(10500);
    expect(assertRefundAmount(paid({ refundedAmount: 5 }), 100)).toBe(10000);
    expect(() => assertRefundAmount(paid(), 0)).toThrow();
    expect(() => assertRefundAmount(paid(), -1)).toThrow();
    expect(() => assertRefundAmount(paid(), 105.01)).toThrow();
    expect(() => assertRefundAmount(paid({ refundedAmount: 5 }), 100.01)).toThrow();
    expect(() => assertRefundAmount(paid({ refundedAmount: 105 }), 0.01)).toThrow();
    expect(() => assertRefundAmount(paid(), NaN)).toThrow();
  });

  it('flips to refunded only once everything is refunded', () => {
    expect(statusAfterRefund(BookingStatus.Confirmed, 10500, 5000)).toBe(BookingStatus.Confirmed);
    expect(statusAfterRefund(BookingStatus.Confirmed, 10500, 10500)).toBe(BookingStatus.Refunded);
    expect(statusAfterRefund(BookingStatus.Cancelled, 10500, 10500)).toBe(BookingStatus.Refunded);
  });

  it('derives the payment status', () => {
    expect(paymentStatusOf(paid({ confirmedAt: null }))).toBe('unpaid');
    expect(paymentStatusOf(paid())).toBe('paid');
    expect(paymentStatusOf(paid({ refundedAmount: 10 }))).toBe('partially_refunded');
    expect(paymentStatusOf(paid({ refundedAmount: 105 }))).toBe('refunded');
  });
});

describe('cancellation policy', () => {
  it('refunds in full before the free-cancellation deadline', () => {
    expect(cancellationPolicy(paid(), NOW)).toMatchObject({ eligible: true, refundAmount: 105 });
  });
  it('refunds what is left after a partial refund', () => {
    expect(cancellationPolicy(paid({ refundedAmount: 5 }), NOW).refundAmount).toBe(100);
  });
  it('refunds nothing after the deadline, for non-refundable or unpaid bookings', () => {
    expect(cancellationPolicy(paid({ freeCancellationUntil: new Date('2026-10-04T00:00:00Z') }), NOW)).toMatchObject({ eligible: false, refundAmount: 0 });
    expect(cancellationPolicy(paid({ refundable: false }), NOW).eligible).toBe(false);
    expect(cancellationPolicy(paid({ freeCancellationUntil: null }), NOW).eligible).toBe(false);
    expect(cancellationPolicy(paid({ confirmedAt: null }), NOW).eligible).toBe(false);
  });
  it('resolves the refund choice', () => {
    expect(resolveCancellationRefund(paid(), 'policy', undefined, NOW)).toBe(105);
    expect(resolveCancellationRefund(paid(), 'none', undefined, NOW)).toBe(0);
    expect(resolveCancellationRefund(paid({ freeCancellationUntil: null }), 'full', undefined, NOW)).toBe(105);
    expect(resolveCancellationRefund(paid(), 'custom', 40, NOW)).toBe(40);
    expect(() => resolveCancellationRefund(paid(), 'custom', 500, NOW)).toThrow();
    expect(() => resolveCancellationRefund(paid(), 'custom', undefined, NOW)).toThrow();
  });
});
