/** Static country list for pickers (`GET /admin/tax/countries`) and for turning a catalog country name into an ISO code. */
export interface Country {
  code: string;
  name: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'OM', name: 'Oman' },
  { code: 'JO', name: 'Jordan' },
  { code: 'EG', name: 'Egypt' },
  { code: 'TR', name: 'Turkey' },
  { code: 'IN', name: 'India' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'MV', name: 'Maldives' },
  { code: 'NP', name: 'Nepal' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'PH', name: 'Philippines' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'GR', name: 'Greece' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'HU', name: 'Hungary' },
  { code: 'HR', name: 'Croatia' },
  { code: 'RU', name: 'Russia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KE', name: 'Kenya' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'MA', name: 'Morocco' },
  { code: 'MU', name: 'Mauritius' },
  { code: 'SC', name: 'Seychelles' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico' },
  { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' },
];

const ALIASES: Record<string, string> = {
  uae: 'AE',
  'u.a.e.': 'AE',
  emirates: 'AE',
  dubai: 'AE',
  'abu dhabi': 'AE',
  ksa: 'SA',
  uk: 'GB',
  'u.k.': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  usa: 'US',
  'u.s.a.': 'US',
  'united states of america': 'US',
  america: 'US',
  turkiye: 'TR',
  'czech republic': 'CZ',
  holland: 'NL',
  'the netherlands': 'NL',
  'south korea': 'KR',
  korea: 'KR',
  'russian federation': 'RU',
  bharat: 'IN',
};

const BY_NAME = new Map(COUNTRIES.map((country) => [country.name.toLowerCase(), country.code]));
const CODES = new Set(COUNTRIES.map((country) => country.code));

/**
 * ISO code for a country given as an ISO alpha-2 code or an English name ("India", "UAE"); `null` when it cannot be
 * told. Catalog products store the country as free text, so this is how a product gets its tax country.
 */
export function resolveCountryCode(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) {
    const upper = text.toUpperCase();
    if (CODES.has(upper) || upper === 'UK') return upper === 'UK' ? 'GB' : upper;
    return upper;
  }
  const lower = text.toLowerCase();
  return BY_NAME.get(lower) ?? ALIASES[lower] ?? null;
}
