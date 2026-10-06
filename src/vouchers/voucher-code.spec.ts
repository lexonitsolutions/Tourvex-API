import { evaluateVoucher, formatVoucherCode, generateVoucherCode, normalizeVoucherCode, voucherUrl } from './voucher-code';

describe('voucher codes', () => {
  it('generates 16 base32 characters', () => {
    for (let i = 0; i < 200; i++) expect(generateVoucherCode()).toMatch(/^[A-Z2-7]{16}$/);
  });

  it('is random: no collisions in 20,000 codes and no sequential pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(generateVoucherCode());
    expect(seen.size).toBe(20_000);
    const first = [...seen].map((code) => code[0]);
    expect(new Set(first).size).toBeGreaterThan(20);
  });

  it('encodes known bytes deterministically (RFC 4648)', () => {
    expect(generateVoucherCode(Buffer.alloc(10, 0))).toBe('AAAAAAAAAAAAAAAA');
    expect(generateVoucherCode(Buffer.alloc(10, 0xff))).toBe('7777777777777777');
  });

  it('normalises codes, grouped codes and QR URLs; rejects everything else', () => {
    const code = 'ABCDEFGH23456723';
    expect(normalizeVoucherCode(code)).toBe(code);
    expect(normalizeVoucherCode(' abcd-efgh-2345-6723 ')).toBe(code);
    expect(normalizeVoucherCode(`https://tourvex.example/v/${code}`)).toBe(code);
    expect(normalizeVoucherCode(`https://tourvex.example/v/${code}?x=1`)).toBe(code);
    expect(normalizeVoucherCode('TVX-2026-1A2B3C4D')).toBeNull();
    expect(normalizeVoucherCode('short')).toBeNull();
    expect(normalizeVoucherCode('ABCDEFGH23456781')).toBeNull();
    expect(normalizeVoucherCode('x'.repeat(400))).toBeNull();
  });

  it('formats for display and builds the QR url from the code only', () => {
    expect(formatVoucherCode('ABCDEFGH23456723')).toBe('ABCD-EFGH-2345-6723');
    expect(voucherUrl('https://tourvex.example/', 'ABCDEFGH23456723')).toBe('https://tourvex.example/v/ABCDEFGH23456723');
  });
});

describe('evaluateVoucher', () => {
  const base = { status: 'issued' as const, serviceDay: '2026-10-05', bookingStatus: 'confirmed' };
  it('is valid only on the service day', () => {
    expect(evaluateVoucher(base, '2026-10-05')).toBe('valid');
    expect(evaluateVoucher(base, '2026-10-04')).toBe('too_early');
    expect(evaluateVoucher(base, '2026-10-06')).toBe('expired');
  });
  it('reports used and void vouchers before the date window', () => {
    expect(evaluateVoucher({ ...base, status: 'redeemed' }, '2026-10-09')).toBe('already_redeemed');
    expect(evaluateVoucher({ ...base, status: 'void' }, '2026-10-05')).toBe('void');
  });
  it('refuses vouchers of bookings that are not confirmed', () => {
    expect(evaluateVoucher({ ...base, bookingStatus: 'cancelled' }, '2026-10-05')).toBe('booking_inactive');
  });
  it('accepts a booking without a service day', () => {
    expect(evaluateVoucher({ ...base, serviceDay: null }, '2030-01-01')).toBe('valid');
  });
});
