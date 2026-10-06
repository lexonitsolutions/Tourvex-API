# Currency conversion contract

All catalog prices are **stored in AED**. The API converts them on the way out when the client asks for another currency, so the
site never does money maths itself. Frontend: `Tourvex-NextJS`; backend: this NestJS API. Base URL `/api/v1`.

## Rate source (important)
- Google has **no public exchange-rate API** (scraping its widget is against its terms and breaks), so it is not used.
- Default source: ExchangeRate-API open endpoint `https://open.er-api.com/v6/latest/AED` (no key, ~160 currencies incl. AED, updates daily,
  free tier requires attribution: "Rates by ExchangeRate-API"). Configurable with `FX_API_URL` (must return `{ result:"success", base_code, rates:{...}, time_last_update_unix }`).
  The code must hide the provider behind one small adapter so another source (ECB, paid provider with a key in `FX_API_KEY`) is a one-file change.
- Rates are **indicative mid-market rates**. Bookings and payments are always charged in AED; the UI says so.

## Rate store
- Mongo collection `fx_rates` (one doc: `base:"AED"`, `rates:{CODE:number}`, `providerUpdatedAt`, `fetchedAt`, `source`).
- Refresh on boot (if doc missing or older than `FX_REFRESH_HOURS`, default 6) and then every `FX_REFRESH_HOURS` with an unref'd timer
  (no new cron dependency; skip refresh when `NODE_ENV=test`). Multi-instance safe enough: last write wins, never blocks requests.
- Fetch: timeout 5 s, validate response (every rate finite and > 0, AED === 1), reject otherwise and keep the previous doc. Never log full payloads.
- In-memory copy of the latest rates; requests never wait on the network. If no rates exist at all (first boot offline) conversion is a no-op
  and responses stay in AED (honest: `currency` stays "AED").
- A rate older than `FX_MAX_AGE_HOURS` (default 72) is **stale**: still used, but flagged `stale: true` in `/currency/rates`.
- Optional `FX_MARKUP_PERCENT` (default 0, 0-10) applied to non-AED conversions.

## Supported currencies
Exactly these 50 (the picker list): AED AMD AUD AZN BDT BHD BRL CAD CHF CNY DKK EGP EUR GBP GEL HKD IDR INR JOD JPY KES KRW KWD KZT LKR MAD MOP MUR MVR MYR
NOK NPR NZD OMR PHP PKR QAR RSD RUB SAR SCR SEK SGD THB TRY TZS USD UZS VND ZAR. Unknown / lowercase-invalid codes: lowercase is accepted and
upper-cased; an unsupported code is **ignored** (response stays AED), not a 400, so old links never break.

## Endpoint
`GET /currency/rates` (public, cacheable `Cache-Control: public, max-age=300`)
```json
{ "base": "AED", "updatedAt": "2026-10-03T00:02:32.000Z", "fetchedAt": "...", "stale": false,
  "source": "ExchangeRate-API", "attribution": "Rates by ExchangeRate-API",
  "rates": { "AED": 1, "USD": 0.2723, "EUR": 0.2321 }, "currencies": ["AED","AMD", "..."] }
```
`rates` contains only supported currencies. Never 5xx on missing data: `{ base:"AED", rates:{AED:1}, stale:true, updatedAt:null, ... }`.

## Conversion of responses
- A **global interceptor** converts every Money object in the JSON of eligible responses. Money = a plain object with exactly `amount:number` and
  `currency:string` (extra keys allowed). It converts from its own `currency` (normally AED) to the requested one using cross rates through AED,
  rounds to the target currency's minor units (0 decimals for JPY KRW VND IDR UZS TZS... use `Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`),
  and sets `currency` to the target. Money with an unknown source currency is left untouched. Numbers that are not inside a Money object are never touched.
- Applies to **GET** requests only, on public read routes of: activities/catalog, holidays, visas, cruises, search/platform home (anything that returns
  Money). The requested currency is the `currency` query param. **Excluded** (must stay AED): bookings, payments, crm/billing/invoices, admin and
  `*/admin/*` routes, enquiries, any non-GET. Implement as an allow-list of route prefixes in one place.
- Existing per-module `currency` query handling/echoing must not double convert: the interceptor owns conversion; modules keep returning AED
  (the top-level `currency` echo is rewritten by the interceptor when it converted, set to the target).
- Add response header `X-Currency: <target>` and `X-FX-Updated: <iso>` when converted; add `Vary` awareness is not needed (query param).
- Price filters/sorts (`minPrice`, `maxPrice`, `sort=price_*`) keep operating on **AED** values. Where a client sends `minPrice/maxPrice`
  together with `currency`, the API treats those numbers as being **in the requested currency** and converts them to AED before querying
  (only for modules that already take price filters: activities, holidays; check which do).

## Frontend behaviour
- Selected currency lives in React context AND a cookie `tourvex.currency` (path `/`, 1 year, SameSite=Lax) so server components render the
  right currency on first paint. Switching currency writes the cookie, updates context, and refreshes server data (`router.refresh()`), and
  client-fetched lists/pages refetch with the new currency.
- Every API call that returns prices is made with `?currency=<selected>`; every displayed price is formatted from the response's own `currency`.
- Search/listing price filters send values in the selected currency.
- Wishlist/recent items that are fetched client side refetch on currency change.
- Where a price is shown the UI never claims a guaranteed rate; the locale modal and checkout/enquiry areas say: "Prices are shown in <CUR> at
  indicative rates (updated <date>). Payments are charged in AED." plus the provider attribution. Booking/checkout screens show the AED amount that will be charged.
- No client-side conversion maths. The picker keeps its current 50 currencies and may show the rate update time from `/currency/rates`.

## Implementation notes
No contract change. Details the spec left open:
- Code lives in `src/currency/` (pure helpers in `currency.conversion.ts`, provider adapter in `fx-provider.ts`, allow-list in `currency.constants.ts`). The interceptor is registered with `APP_INTERCEPTOR` in `app.module.ts`.
- **Eligible routes** (GET only, first path segment after the prefix): `catalog`, `holidays`, `visas`, `cruises`, `platform`. Any path containing the segment `admin`, `enquiries`, `bookings`, `payments`, `crm`, `billing` or `invoices` is excluded even under an allowed prefix. There is no separate search route; `platform/settings` carries no Money but is allowed by the spec.
- **No price filters exist.** None of activities, holidays, visas or cruises accepts `minPrice`/`maxPrice` (the DTOs use `forbidNonWhitelisted`, so those params are a 400 today). The "filters are in the requested currency" rule is therefore not implemented; `sort=price_*` keeps operating on AED. Add the AED conversion in the DTO/service when such a filter is introduced.
- **Echoed `currency`**: modules echo `?currency=` in a top-level `currency` field. The interceptor owns it: the target when conversion is active, otherwise `"AED"` (so `?currency=XYZ` or an empty rate store answers `AED`).
- **Active conversion** requires a supported target with a stored rate. `X-Currency` / `X-FX-Updated` are only set for non-AED targets when active.
- **Staleness** is measured from the provider's `time_last_update_unix` (`updatedAt`).
- `currencies` in `/currency/rates` is always the full list of 50 supported codes, even when `rates` only holds `AED` (no data).
- Rates are loaded from Mongo at boot in every environment; the network refresh and the timer are skipped only when `NODE_ENV=test` (so Playwright conversion checks need a previously stored `fx_rates` doc and skip otherwise). The boot refresh is fire-and-forget and never blocks startup.
- `FX_API_KEY` is substituted into a `{key}` placeholder in `FX_API_URL` when both are set; the default provider needs no key. Config: `FX_API_URL`, `FX_API_KEY`, `FX_REFRESH_HOURS` (6), `FX_MAX_AGE_HOURS` (72), `FX_MARKUP_PERCENT` (0-10), validated in `src/config/env.validation.ts` and listed in `.env.example`.
