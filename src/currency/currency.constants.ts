export const BASE_CURRENCY = 'AED';

/** The picker list; anything else is ignored (responses stay in AED). */
export const SUPPORTED_CURRENCIES: readonly string[] = (
  'AED AMD AUD AZN BDT BHD BRL CAD CHF CNY DKK EGP EUR GBP GEL HKD IDR INR JOD JPY KES KRW KWD KZT LKR MAD MOP MUR MVR MYR ' +
  'NOK NPR NZD OMR PHP PKR QAR RSD RUB SAR SCR SEK SGD THB TRY TZS USD UZS VND ZAR'
).split(' ');

/**
 * Allow-list of first route segments (after the global prefix) whose GET responses may be converted.
 * Everything else (bookings, payments, crm/*, users, auth, suppliers, media, health, currency) stays AED.
 * Every one of these modules returns prices as Money objects { amount, currency }.
 */
export const CONVERTIBLE_ROUTE_PREFIXES: readonly string[] = [
  'catalog',
  'holidays',
  'visas',
  'cruises',
  'events',
  'platform',
];

/** Path segments that always opt a route out, even under an allowed prefix (staff views, enquiries). */
export const EXCLUDED_ROUTE_SEGMENTS: readonly string[] = [
  'admin',
  'enquiries',
  'bookings',
  'checkout',
  'payments',
  'crm',
  'billing',
  'invoices',
];

export const FX_PROVIDER = Symbol('FX_PROVIDER');

export const DEFAULT_FX_API_URL = 'https://open.er-api.com/v6/latest/AED';
export const DEFAULT_REFRESH_HOURS = 6;
export const DEFAULT_MAX_AGE_HOURS = 72;
