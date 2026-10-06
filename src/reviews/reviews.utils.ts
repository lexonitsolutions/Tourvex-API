import { operatingToday } from '../catalog/activity-booking.utils';

export type RatingBand = 'excellent' | 'veryGood' | 'average' | 'poor' | 'terrible';

export interface RatingSummary {
  average: number;
  count: number;
  breakdown: Record<RatingBand, number>;
}

/** >=4.5 excellent, 3.5-<4.5 veryGood, 2.5-<3.5 average, 1.5-<2.5 poor, <1.5 terrible. */
export function ratingBand(rating: number): RatingBand {
  if (rating >= 4.5) return 'excellent';
  if (rating >= 3.5) return 'veryGood';
  if (rating >= 2.5) return 'average';
  if (rating >= 1.5) return 'poor';
  return 'terrible';
}

/** `counts[rating]` is how many published reviews gave that 1-5 rating. Null when there are none. */
export function computeRatingSummary(counts: Partial<Record<number, number>>): RatingSummary | null {
  const breakdown: Record<RatingBand, number> = {
    excellent: 0,
    veryGood: 0,
    average: 0,
    poor: 0,
    terrible: 0,
  };
  let count = 0;
  let sum = 0;
  for (const [rating, n] of Object.entries(counts)) {
    const value = Number(rating);
    if (!n || n < 1 || !(value >= 1 && value <= 5)) continue;
    count += n;
    sum += value * n;
    breakdown[ratingBand(value)] += n;
  }
  if (count === 0) return null;
  return { average: Math.round((sum / count) * 10) / 10, count, breakdown };
}

/** "Alisa Parker" -> "Alisa P."; first name only when there is no last name. */
export function displayName(firstName?: string | null, lastName?: string | null): string {
  const first = (firstName ?? '').trim().split(/\s+/)[0] ?? '';
  const initial = (lastName ?? '').trim().charAt(0).toUpperCase();
  if (!first) return 'Guest';
  return initial ? `${first} ${initial}.` : first;
}

export type ReviewEligibility = 'ok' | 'wrong_activity' | 'not_confirmed' | 'service_not_passed' | 'already_reviewed';

/** Verified-booking rule: own confirmed booking of this activity, service day passed, one review each. */
export function reviewEligibility(input: {
  booking: { activitySlug?: string | null; status: string; serviceDay?: string | null };
  activitySlug: string;
  alreadyReviewed: boolean;
  now: Date;
}): ReviewEligibility {
  const { booking, activitySlug, alreadyReviewed, now } = input;
  if (booking.activitySlug !== activitySlug) return 'wrong_activity';
  if (booking.status !== 'confirmed') return 'not_confirmed';
  if (!booking.serviceDay || booking.serviceDay >= operatingToday(now)) return 'service_not_passed';
  if (alreadyReviewed) return 'already_reviewed';
  return 'ok';
}
