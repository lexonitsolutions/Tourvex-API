# Cruises API contract

Source of truth for the Cruises feature. The NestJS API implements it; the Next.js site (`Tourvex-NextJS`) consumes it.
Base URL `/api/v1`. Read endpoints are **public** (`@Public()`). Prices are stored in **AED**; no conversion (the `currency`
query is accepted and echoed, like catalog/holidays/visas).

## Content rules (important)

- Content is **our own**. Nothing is scraped or copied from another company's site.
- **No real cruise lines or ships in sample data.** Samples use FICTIONAL lines and ships (e.g. "Azure Meridian Cruises" /
  "MV Horizon Star") so the site never presents invented itineraries or fares as if a real operator offered them.
  All samples are `isSample: true` and hidden from public endpoints when `NODE_ENV=production` unless `CRUISES_ALLOW_SAMPLES=true`.
  Real products are loaded through admin endpoints or `npm run seed:cruises -- --file <json>`.
- Fares are indicative "from" prices per person; availability and final fares are confirmed on enquiry (no payments here).
- No fake ratings/reviews/statistics/guarantees anywhere.
- **Departure dates are never stale:** the API returns only departures on or after "today" (server date, UTC). The sample seed
  generates its departure dates relative to the seed date (several per month over the next ~8 months) so a re-seed refreshes them.
  A cruise with no upcoming departures is still returned by `GET /cruises/:slug` (with `departures: []`) but is excluded from
  `home` and list endpoints (never show a bookable-looking card with nothing to book).

## Types

```ts
type Money = { amount: number; currency: string };           // "AED"

type CruiseCard = {
  id: string; slug: string;
  title: string;                       // "Eight Nights Mediterranean Escape"
  coverImage: string;                  // "/images/..." or https
  cruiseLine: string;                  // fictional in samples
  shipName: string;
  departureCity: string;               // "Istanbul"
  departureCountry: string;
  region: string;                      // "Mediterranean"
  durationNights: number; durationDays: number;
  nextDepartures: string[];            // up to 4 upcoming ISO dates "2026-11-14", ascending
  ports: string[];                     // first 6 itinerary stops, names only (sea days shown as "At Sea")
  portCount: number;                   // total itinerary stops
  price: Money | null;                 // lowest "from" fare per person
  tags: string[];                      // e.g. ["Family", "Luxury"]
};

type Cruise = CruiseCard & {
  summary: string;
  description: string;                 // paragraphs separated by \n\n
  images: { url: string; alt: string }[];
  departures: string[];                // ALL upcoming ISO dates (max 60), ascending
  itinerary: { day: number; port: string; country?: string; type: "port" | "sea" | "embark" | "disembark"; description: string }[];
  cabins: { type: string; description: string; fromPrice: Money | null }[];   // 2-4 categories
  highlights: string[]; inclusions: string[]; exclusions: string[];
  notes: string;                       // disclaimer shown on the page
  isSample?: boolean;                  // only outside production
  updatedAt: string;
};

type Banner = { id: string; eyebrow?: string; title: string; subtitle: string; description: string;
                image: string; ctaLabel: string; ctaHref: string };            // ctaHref like "/cruises/from/Dubai"
type CityCard = { name: string; country: string; count: number; image: string; startingFrom: Money | null };
type Section = { slug: string; title: string; subtitle: string; city: string; items: CruiseCard[] };
```

## Endpoints

### `GET /cruises/home`
`{ banners: Banner[], cities: CityCard[], countries: CountryCard[], sections: Section[], lines: string[], currency }`
- `cities`: departure cities with at least one upcoming cruise, most cruises first (image = cover of its first cruise).
- `countries`: departure countries with upcoming cruises, most cruises first: `{ name, count, image, cities: string[] }` (cities ordered by popularity; image = cover of its most popular cruise).
- `sections`: one "Best sellers from <city>" section per city for the top 4 cities, each up to 12 cruises ordered by `popularity` desc.
  `slug` like `from-istanbul`, `title` "Best sellers from Istanbul".
- `lines`: distinct cruise line names (for filters/labels).

### `GET /cruises`
Query: `q` (text on title/ship/line/ports, case+diacritic-insensitive), `city` (departure city, exact), `line` (exact), `region` (exact),
`month` (`YYYY-MM`, cruises with a departure in that month), `minNights`, `maxNights`, `sort` (`popular` default | `price_asc` | `price_desc` |
`nights_asc` | `nights_desc` | `soonest`), `page` (1), `limit` (default 12, max 48), `currency`.
`{ items: CruiseCard[], pagination, facets: { cities: [{name,count}], lines: [...], regions: [...], months: [{name: "2026-11", count}] }, currency }`
Facets are over all visible cruises with an upcoming departure. Unknown values give empty `items`; bad numbers/enums/month format give 400.

### `GET /cruises/:slug`
`{ cruise: Cruise, related: CruiseCard[], currency }`; related = same departure city or region, max 6, excludes itself. 404 `{message:"Cruise not found"}`.

### Enquiries (lead capture, real, no payments)
- `POST /cruises/:slug/enquiries` **public**, throttled 5/min/IP. Body: `{ fullName (2-120), email, phone (6-20), nationality (2-80),
  adults (int 1-10), children (int 0-10), departureDate? (ISO date; must be one of the cruise's upcoming departures if given),
  cabinType? (<=60), message? (<=1000), consent: true }` (consent must be boolean `true`; unknown fields 400). Optional Clerk token links `userId`
  (never required; failures ignored). Returns `201 { id, reference, status: "new" }` (`reference` = `CQ-` + 8 base32 chars). 404 unknown/unpublished.
- `GET /cruises/enquiries/admin` roles `sales, support, admin, super_admin`: paged (`status`, `page`, `limit`), newest first.
- `PATCH /cruises/enquiries/:id` same roles: `{ status: "new"|"contacted"|"closed", note? }`.
No PII in logs; never echo personal data back beyond `{ id, reference, status }`.

### Admin catalog (roles `content, admin, super_admin`)
`POST /cruises`, `PATCH /cruises/:id`, `DELETE /cruises/:id`, `GET /cruises/admin/all`. Static routes (`home`, `admin/all`, `enquiries/admin`)
before `:slug`. Slug unique (409). Departures are stored as ISO dates; reject past dates on create/update (400).

## Storage (Mongoose, same conventions as `src/holidays` and `src/visas`)
- `cruises`: slug unique, title, summary, description, cruiseLine (idx), shipName, departureCity (idx), departureCountry, region (idx),
  durationNights, durationDays, departures [Date] (idx), itinerary[], cabins[], images[], highlights/inclusions/exclusions, notes, tags, price,
  popularity, published, isSample, timestamps; text index on title/shipName/cruiseLine/itinerary ports.
- `cruise_banners`: eyebrow, title, subtitle, description, image, ctaLabel, ctaHref, order, published.
- `cruise_enquiries`: cruiseId, cruiseSlug, reference unique, fullName, email, phone, nationality, adults, children, departureDate?, cabinType?,
  message?, consentAt, userId?, status, note?, timestamps; index status+createdAt.

## Frontend routes (`app/(market)`)
- `/cruises`: hero banner carousel, "Explore Cruises by Departure City" rail, "Best sellers from <city>" sections (cards), "Your journey, our commitment" band
  (honest qualitative points), enquiry-friendly CTAs.
- `/cruises/from/[city]`: listing with filters (line, region, month, nights), sort, load more.
- `/cruises/[slug]`: gallery, overview, departures picker, day-by-day itinerary timeline (sea/port stops), cabins, inclusions/exclusions, related cruises,
  sticky price card + "Start enquiry" sheet.

## Implementation notes (API)
- Departures are stored as unique, ascending UTC-midnight dates. Admin payloads must send `coverImage`, `itinerary` (2-62 stops, day 1..`durationDays`, consecutive)
  and optionally `cabins` (2-4). `durationDays` defaults to `durationNights + 1` (on PATCH, changing only `durationNights` resets it the same way).
- `GET /cruises/admin/all` returns every cruise (unpublished, sample, no upcoming departures) as cards plus `published` and `isSample`.
- `q` searches title, ship, line and itinerary port names only (not the departure city/country; use `city`).
- Facets count each cruise once per value; `months` is capped at 24 entries, the others at 20.
- Validation errors use the standard Nest shape `{ message: string[], error, statusCode }`; 404 is `{ message: "Cruise not found", error, statusCode }`.
