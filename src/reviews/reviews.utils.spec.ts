import { computeRatingSummary, displayName, ratingBand, reviewEligibility } from './reviews.utils';

describe('ratingBand', () => {
  it('maps averages to the documented bands at the boundaries', () => {
    expect(ratingBand(5)).toBe('excellent');
    expect(ratingBand(4.5)).toBe('excellent');
    expect(ratingBand(4.49)).toBe('veryGood');
    expect(ratingBand(3.5)).toBe('veryGood');
    expect(ratingBand(3.49)).toBe('average');
    expect(ratingBand(2.5)).toBe('average');
    expect(ratingBand(2.49)).toBe('poor');
    expect(ratingBand(1.5)).toBe('poor');
    expect(ratingBand(1.49)).toBe('terrible');
    expect(ratingBand(1)).toBe('terrible');
  });
});

describe('computeRatingSummary', () => {
  it('is null without reviews', () => {
    expect(computeRatingSummary({})).toBeNull();
    expect(computeRatingSummary({ 5: 0 })).toBeNull();
  });

  it('averages to one decimal and fills the breakdown', () => {
    expect(computeRatingSummary({ 5: 3, 4: 1, 1: 1 })).toEqual({
      average: 4,
      count: 5,
      breakdown: { excellent: 3, veryGood: 1, average: 0, poor: 0, terrible: 1 },
    });
    expect(computeRatingSummary({ 5: 1, 4: 1, 3: 1 })?.average).toBe(4);
    expect(computeRatingSummary({ 5: 2, 4: 1 })?.average).toBe(4.7);
  });

  it('ignores out-of-range ratings', () => {
    expect(computeRatingSummary({ 7: 4, 0: 2, 3: 1 })).toMatchObject({ count: 1, average: 3 });
  });
});

describe('displayName', () => {
  it('uses the first name and the last initial only', () => {
    expect(displayName('Alisa', 'Parker')).toBe('Alisa P.');
    expect(displayName('  Mary Ann ', ' o-brien')).toBe('Mary O.');
    expect(displayName('Alisa', '')).toBe('Alisa');
    expect(displayName('', 'Parker')).toBe('Guest');
  });
});

describe('reviewEligibility', () => {
  const now = new Date('2026-10-04T08:00:00.000Z');
  const booking = { activitySlug: 'dubai-frame', status: 'confirmed', serviceDay: '2026-10-01' };
  const check = (over: Partial<Parameters<typeof reviewEligibility>[0]> = {}) =>
    reviewEligibility({ booking, activitySlug: 'dubai-frame', alreadyReviewed: false, now, ...over });

  it('allows a confirmed booking of this activity whose day has passed', () => {
    expect(check()).toBe('ok');
  });

  it('rejects other activities, unconfirmed bookings, future or same-day services and repeats', () => {
    expect(check({ activitySlug: 'other' })).toBe('wrong_activity');
    expect(check({ booking: { ...booking, status: 'pending_payment' } })).toBe('not_confirmed');
    expect(check({ booking: { ...booking, status: 'cancelled' } })).toBe('not_confirmed');
    expect(check({ booking: { ...booking, serviceDay: '2026-10-04' } })).toBe('service_not_passed');
    expect(check({ booking: { ...booking, serviceDay: '2026-10-20' } })).toBe('service_not_passed');
    expect(check({ booking: { ...booking, serviceDay: undefined } })).toBe('service_not_passed');
    expect(check({ alreadyReviewed: true })).toBe('already_reviewed');
  });
});
