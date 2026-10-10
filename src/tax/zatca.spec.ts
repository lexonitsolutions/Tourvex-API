import { amountInWords } from '../crm/billing/amount-words';
import { COUNTRIES, resolveCountryCode } from './countries';
import { parseZatcaTlv, zatcaTlvBase64 } from './zatca';

describe('ZATCA phase-1 TLV QR payload', () => {
  it('encodes seller, VAT number, timestamp, total and VAT as tag-length-value in base64', () => {
    const payload = zatcaTlvBase64({
      sellerName: 'Karnish Tourism LLC',
      vatNumber: '310122393500003',
      timestamp: new Date('2026-10-05T08:30:15.123Z'),
      total: 1150,
      vat: 150,
    });
    const bytes = Buffer.from(payload, 'base64');
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe('Karnish Tourism LLC'.length);
    expect(parseZatcaTlv(payload)).toEqual({
      1: 'Karnish Tourism LLC',
      2: '310122393500003',
      3: '2026-10-05T08:30:15Z',
      4: '1150.00',
      5: '150.00',
    });
  });

  it('counts bytes, not characters, for non-ASCII names', () => {
    const name = 'شركة';
    const payload = zatcaTlvBase64({ sellerName: name, vatNumber: '1', timestamp: new Date(0), total: 1, vat: 0 });
    expect(Buffer.from(payload, 'base64')[1]).toBe(Buffer.byteLength(name));
    expect(parseZatcaTlv(payload)[1]).toBe(name);
  });
});

describe('amountInWords (Indian numbering)', () => {
  it('writes rupees and paise with lakh and crore', () => {
    expect(amountInWords(125_000, 'INR')).toBe('Rupees One Thousand Two Hundred and Fifty Only');
    expect(amountInWords(11_799, 'INR')).toBe('Rupees One Hundred and Seventeen and Ninety Nine Paise Only');
    expect(amountInWords(1_234_567_800, 'INR')).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight Only');
    expect(amountInWords(0, 'INR')).toBe('Rupees Zero Only');
    expect(amountInWords(5_000, 'AED')).toBe('Dirhams Fifty Only');
  });
});

describe('countries', () => {
  it('has unique ISO codes and resolves names, codes and common aliases', () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(resolveCountryCode('India')).toBe('IN');
    expect(resolveCountryCode(' united arab emirates ')).toBe('AE');
    expect(resolveCountryCode('UAE')).toBe('AE');
    expect(resolveCountryCode('de')).toBe('DE');
    expect(resolveCountryCode('UK')).toBe('GB');
    expect(resolveCountryCode('Atlantis')).toBeNull();
    expect(resolveCountryCode('')).toBeNull();
    expect(resolveCountryCode(undefined)).toBeNull();
  });
});
