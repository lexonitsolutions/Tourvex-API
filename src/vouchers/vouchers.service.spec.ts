import { Types } from 'mongoose';
import { VouchersService, qrPath } from './vouchers.service';

/** Tiny in-memory stand-ins for the two Mongoose models the service uses. */
function setup() {
  const bookingId = new Types.ObjectId();
  const voucherId = new Types.ObjectId();
  const voucher: Record<string, any> = {
    _id: voucherId,
    code: 'ABCDEFGH23456723',
    bookingId,
    bookingReference: 'TVX-2026-1A2B3C4D',
    status: 'issued',
    issuedAt: new Date(),
    resendCount: 0,
  };
  const booking = {
    _id: bookingId,
    reference: 'TVX-2026-1A2B3C4D',
    status: 'confirmed',
    title: 'Desert safari',
    serviceDay: '2026-10-05',
    adults: 2,
    children: 1,
    quantity: 3,
  };
  const chain = <T>(value: T) => ({ lean: () => ({ exec: () => Promise.resolve(value) }), exec: () => Promise.resolve(value) });
  const vouchers = {
    findById: () => chain({ ...voucher }),
    findOne: () => chain({ ...voucher }),
    // Mirrors Mongo: the filter check and the update happen as one step.
    findOneAndUpdate: (filter: { status: string }, update: { $set: Record<string, unknown> }) => {
      if (voucher.status !== filter.status) return chain(null);
      Object.assign(voucher, update.$set);
      return chain({ ...voucher });
    },
  };
  const bookings = { findById: () => ({ select: () => chain(booking), ...chain(booking) }), updateOne: () => chain({}) };
  const config = { get: () => 'https://tourvex.example' };
  const service = new VouchersService(vouchers as never, bookings as never, { bookingConfirmed: jest.fn() } as never, config as never);
  return { service, voucher, id: voucherId.toString() };
}

const NOW = new Date('2026-10-05T08:00:00Z');
const staff = { id: new Types.ObjectId().toString(), name: 'gate@example.com' };

describe('VouchersService', () => {
  it('redeems once; every other concurrent scan gets ALREADY_REDEEMED', async () => {
    const { service, voucher, id } = setup();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => service.redeem(id, staff, NOW)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    for (const failure of failed) {
      expect((failure.reason as { getResponse(): { code: string } }).getResponse().code).toBe('ALREADY_REDEEMED');
    }
    expect(voucher.status).toBe('redeemed');
  });

  it('second scan reports when it was redeemed', async () => {
    const { service, id } = setup();
    await service.redeem(id, staff, NOW);
    await expect(service.redeem(id, staff, NOW)).rejects.toMatchObject({
      response: { code: 'ALREADY_REDEEMED', message: expect.stringContaining('Already redeemed at 2026-10-05T08:00:00.000Z') },
    });
  });

  it('refuses outside the service day and for void vouchers', async () => {
    const { service, voucher, id } = setup();
    await expect(service.redeem(id, staff, new Date('2026-10-04T08:00:00Z'))).rejects.toMatchObject({ response: { code: 'TOO_EARLY' } });
    await expect(service.redeem(id, staff, new Date('2026-10-06T08:00:00Z'))).rejects.toMatchObject({ response: { code: 'VOUCHER_EXPIRED' } });
    voucher.status = 'void';
    await expect(service.redeem(id, staff, NOW)).rejects.toMatchObject({ response: { code: 'VOUCHER_VOID' } });
  });

  it('validate answers with the verdict and the traveller count; public lookup has no personal data', async () => {
    const { service } = setup();
    const checked = await service.validate('abcd-efgh-2345-6723', NOW);
    expect(checked).toMatchObject({ verdict: 'valid', ok: true, booking: { travellers: 3, activityTitle: 'Desert safari' } });
    const pub = await service.publicLookup('ABCDEFGH23456723', NOW);
    expect(pub).toMatchObject({ valid: true, activityTitle: 'Desert safari', adults: 2, children: 1 });
    expect(Object.keys(pub).sort()).toEqual(['activityTitle', 'adults', 'children', 'optionName', 'redeemedAt', 'serviceDay', 'startTime', 'status', 'valid']);
    await expect(service.publicLookup('nope')).rejects.toMatchObject({ response: { code: 'VOUCHER_NOT_FOUND' } });
  });

  it('the QR holds only the url with the random code', () => {
    const { service } = setup();
    const qr = service.qrFor('ABCDEFGH23456723');
    expect(qr.text).toBe('https://tourvex.example/v/ABCDEFGH23456723');
    expect(qr.size).toBeGreaterThan(20);
    expect(qr.path.startsWith('M')).toBe(true);
  });

  it('qrPath merges horizontal runs', () => {
    expect(qrPath(3, (x, y) => y === 0 && x < 2)).toBe('M0 0h2v1h-2z');
  });
});
