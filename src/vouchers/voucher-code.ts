import { randomBytes } from 'node:crypto';

/** RFC 4648 base32 alphabet (no padding): A-Z and 2-7. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const VOUCHER_CODE_LENGTH = 16;
const CODE_PATTERN = /^[A-Z2-7]{16}$/;

/** 16 random base32 characters = 80 bits from the OS CSPRNG. Never sequential, never derived from data. */
export function generateVoucherCode(bytes: Buffer = randomBytes(10)): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.slice(0, VOUCHER_CODE_LENGTH);
}

/**
 * Accepts what a person or scanner may hand over: the bare code, the code with dashes/spaces, or
 * the QR URL ending in /v/<code>. Returns the canonical upper-case code, or null when it cannot be one.
 */
export function normalizeVoucherCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > 300) return null;
  let text = input.trim();
  const fromUrl = /\/v\/([A-Za-z0-9-]+)\/?(?:[?#].*)?$/.exec(text);
  if (fromUrl) text = fromUrl[1];
  const code = text.replace(/[\s-]/g, '').toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** Human-friendly grouping for display and manual entry: ABCD-EFGH-IJKL-MNOP. */
export function formatVoucherCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** The URL encoded in the QR image. Contains only the random code. */
export function voucherUrl(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/v/${code}`;
}

export type VoucherVerdict =
  | 'valid'
  | 'already_redeemed'
  | 'void'
  | 'too_early'
  | 'expired'
  | 'booking_inactive';

export interface VoucherFacts {
  status: 'issued' | 'redeemed' | 'void';
  /** Booking service day YYYY-MM-DD (Asia/Dubai). Absent for bookings without a day: always in window. */
  serviceDay?: string | null;
  bookingStatus: string;
}

/**
 * Whether a voucher may be redeemed now. A voucher is only valid on its service day (Asia/Dubai);
 * earlier is too_early, later is expired. Void/redeemed are reported before the date window so a
 * scanned used ticket always says it was used.
 */
export function evaluateVoucher(voucher: VoucherFacts, today: string): VoucherVerdict {
  if (voucher.status === 'void') return 'void';
  if (voucher.status === 'redeemed') return 'already_redeemed';
  if (voucher.bookingStatus !== 'confirmed') return 'booking_inactive';
  if (voucher.serviceDay) {
    if (today < voucher.serviceDay) return 'too_early';
    if (today > voucher.serviceDay) return 'expired';
  }
  return 'valid';
}
