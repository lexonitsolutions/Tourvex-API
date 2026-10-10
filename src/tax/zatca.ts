/**
 * ZATCA (Saudi Arabia) phase-1 simplified invoice QR payload: a TLV (tag, length, value) byte string, base64 encoded.
 * Tags: 1 seller name, 2 VAT registration number, 3 ISO 8601 timestamp, 4 invoice total with VAT, 5 VAT amount.
 * Phase 2 (cryptographic stamp, reporting to ZATCA) is NOT implemented.
 */
export interface ZatcaFields {
  sellerName: string;
  vatNumber: string;
  timestamp: Date;
  total: number;
  vat: number;
}

const tlv = (tag: number, value: string): Buffer => {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > 255) throw new Error('ZATCA field longer than 255 bytes');
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
};

export function zatcaTlvBase64(fields: ZatcaFields): string {
  return Buffer.concat([
    tlv(1, fields.sellerName.slice(0, 120)),
    tlv(2, fields.vatNumber),
    tlv(3, fields.timestamp.toISOString().replace(/\.\d{3}Z$/, 'Z')),
    tlv(4, fields.total.toFixed(2)),
    tlv(5, fields.vat.toFixed(2)),
  ]).toString('base64');
}

/** Reads a payload back (tests and support tooling). */
export function parseZatcaTlv(base64: string): Record<number, string> {
  const bytes = Buffer.from(base64, 'base64');
  const out: Record<number, string> = {};
  for (let i = 0; i < bytes.length; ) {
    const tag = bytes[i];
    const length = bytes[i + 1];
    out[tag] = bytes.subarray(i + 2, i + 2 + length).toString('utf8');
    i += 2 + length;
  }
  return out;
}
