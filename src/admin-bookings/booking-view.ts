import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { paymentStatusOf } from '../bookings/booking-rules';

export const BOOKING_STATUS_VALUES = Object.values(BookingStatus);

export interface TimelineItem {
  id: string;
  type: string;
  at: Date;
  title: string;
  detail?: string;
  actor?: string;
  tone?: 'success' | 'warning' | 'danger' | 'info';
}

export interface TimelineRefund {
  id: string;
  at: Date;
  amount: number;
  currency: string;
  status: string;
  mode: string;
  reason: string;
  actorEmail?: string;
}

const EVENT_TITLES: Record<string, { title: string; tone?: TimelineItem['tone'] }> = {
  cancellation_requested: { title: 'Cancellation requested by the customer', tone: 'warning' },
  cancellation_rejected: { title: 'Cancellation request rejected', tone: 'info' },
  cancelled: { title: 'Booking cancelled', tone: 'danger' },
  refunded: { title: 'Refund recorded', tone: 'warning' },
  confirmed_manually: { title: 'Confirmed by staff (offline payment)', tone: 'success' },
  confirmation_resent: { title: 'Confirmation resent', tone: 'info' },
  voucher_issued: { title: 'Voucher issued', tone: 'success' },
  voucher_resent: { title: 'Voucher sent to the customer', tone: 'info' },
  voucher_voided: { title: 'Voucher voided', tone: 'danger' },
  service_date_changed: { title: 'Service date changed', tone: 'info' },
};

/**
 * Chronological history assembled from what the booking already records: creation, payment,
 * operational events, and the refund ledger. Oldest first.
 */
export function buildTimeline(
  booking: Pick<Booking, 'createdAt' | 'confirmedAt' | 'paymentReference' | 'events' | 'status' | 'cancelledAt'> & { reference: string },
  refunds: readonly TimelineRefund[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    { id: 'created', type: 'created', at: booking.createdAt, title: 'Booking created', detail: booking.reference, tone: 'info' },
  ];
  if (booking.confirmedAt) {
    const manual = (booking.events ?? []).some((e) => e.type === 'confirmed_manually');
    items.push({
      id: 'paid',
      type: 'paid',
      at: booking.confirmedAt,
      title: manual ? 'Payment recorded and booking confirmed' : 'Paid and confirmed',
      detail: booking.paymentReference ? `Payment reference ${booking.paymentReference}` : undefined,
      tone: 'success',
    });
  }
  (booking.events ?? []).forEach((event, index) => {
    // The ledger rows below carry the refund detail; skip the duplicate event.
    if (event.type === 'refunded') return;
    const meta = EVENT_TITLES[event.type] ?? { title: event.type };
    items.push({
      id: `event-${index}`,
      type: event.type,
      at: event.at,
      title: meta.title,
      detail: event.text && event.text.toLowerCase() !== meta.title.toLowerCase() ? event.text : undefined,
      actor: event.actorName,
      tone: meta.tone,
    });
  });
  for (const refund of refunds) {
    items.push({
      id: `refund-${refund.id}`,
      type: refund.status === 'failed' ? 'refund_failed' : 'refunded',
      at: refund.at,
      title:
        refund.status === 'failed'
          ? `Refund of ${refund.currency} ${refund.amount.toFixed(2)} failed`
          : `Refunded ${refund.currency} ${refund.amount.toFixed(2)}${refund.mode === 'mock' ? ' (simulated)' : refund.mode === 'manual' ? ' (recorded manually)' : ''}`,
      detail: refund.reason,
      actor: refund.actorEmail,
      tone: refund.status === 'failed' ? 'danger' : 'warning',
    });
  }
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Row of the bookings list. */
export function listItem(
  booking: Booking,
  user?: { firstName?: string; lastName?: string; email?: string } | null,
) {
  const name = booking.customer?.fullName ?? ([user?.firstName, user?.lastName].filter(Boolean).join(' ') || null);
  return {
    id: booking._id.toString(),
    reference: booking.reference,
    orderReference: booking.orderReference ?? null,
    status: booking.status,
    paymentStatus: paymentStatusOf(booking),
    serviceType: booking.serviceType,
    title: booking.title,
    optionName: booking.optionName ?? null,
    activitySlug: booking.activitySlug ?? null,
    serviceDay: booking.serviceDay ?? (booking.serviceDate ? booking.serviceDate.toISOString().slice(0, 10) : null),
    startTime: booking.startTime ?? null,
    adults: booking.adults ?? booking.quantity,
    children: booking.children ?? 0,
    customerName: name,
    customerEmail: booking.customer?.email ?? user?.email ?? null,
    total: booking.total,
    refundedAmount: booking.refundedAmount ?? 0,
    currency: booking.currency,
    createdAt: booking.createdAt,
    confirmedAt: booking.confirmedAt ?? null,
  };
}
