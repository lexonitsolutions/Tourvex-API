# Holidays API contract

Source of truth for the Holidays feature. The NestJS API implements it; the Next.js site (`Tourvex-NextJS`) consumes it.
Base URL: `/api/v1`. All read endpoints are **public** (`@Public()`). Prices are stored in **AED** and the API does not
convert currencies (the `currency` query is accepted for forward compatibility and echoed back, like the catalog API).

## Content rules (important)

- Content is **our own**. Nothing is scraped or copied from another travel company's site (names, descriptions, photos,
  prices, review scores belong to their owners).
- Ratings/reviews are **never invented**. `rating` is `null` unless real review data exists.
- The seed ships **sample** packages with `isSample: true`. In production (`NODE_ENV=production`) sample packages are
  hidden from every public endpoint unless `HOLIDAYS_ALLOW_SAMPLES=true`. In development they are shown.
  Real packages are loaded through the admin endpoints or `npm run seed:holidays -- --file <json>`.
- Images are paths served by the existing media API through the website's `/images/<file>` rewrite
  (for example `/images/destination-03.jpg`), or absolute `https://` URLs.

## Types

```ts
type Money = { amount: number; currency: string };           // currency "AED"

type PackageCard = {
  id: string;
  slug: string;
  title: string;
  coverImage: string;
  destinations: string[];            // cities, e.g. ["Dubai"]
  country: string;                   // e.g. "United Arab Emirates"
  durationNights: number;
  durationDays: number;
  price: Money | null;               // starting price per person
  salePrice: Money | null;
  rating: { average: number; count: number } | null;
  themes: string[];                  // e.g. ["Family", "Beach"]
};

type Package = PackageCard & {
  summary: string;                   // one or two sentences
  description: string;               // longer text, plain paragraphs separated by \n\n
  images: { url: string; alt: string }[];     // gallery, first = cover
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  itinerary: { day: number; title: string; description: string }[];
  collections: string[];             // collection slugs this package belongs to
  isSample?: boolean;                // only present outside production
  updatedAt: string;
};

type Banner = {
  id: string; eyebrow?: string; title: string; subtitle: string; description: string;
  image: string; ctaLabel: string; ctaHref: string;           // e.g. "/holidays/destination/Dubai"
};

type CityCard = { name: string; country: string; count: number; image: string; startingFrom: Money | null };
type CountryCard = { name: string; count: number; image: string; cities: string[] };

type Collection = { slug: string; title: string; subtitle: string; items: PackageCard[] };
```

## Endpoints

### `GET /holidays/home`
Everything the landing page needs in one request.
```json
{
  "banners":    [Banner],                 // ordered, published only
  "cities":     [CityCard],               // derived from published packages, most packages first
  "countries":  [CountryCard],            // derived from published packages, most packages first
  "collections":[Collection],             // ordered, published, each with up to 12 PackageCards (empty collections omitted)
  "currency": "AED"
}
```

### `GET /holidays`
Query: `q` (title/destination/theme text), `destination`, `country`, `theme`, `collection` (slug),
`minNights`, `maxNights`, `sort` (`popular` default | `price_asc` | `price_desc` | `nights_asc` | `nights_desc` | `newest`),
`page` (default 1), `limit` (default 12, max 48), `currency` (echoed).
```json
{
  "items": [PackageCard],
  "pagination": { "page": 1, "limit": 12, "total": 0, "pages": 0 },
  "facets": { "destinations": [{ "name": "Dubai", "count": 3 }], "countries": [...], "themes": [...] },
  "currency": "AED"
}
```
`facets` are computed over the full published set (not only the current page). Unknown query values return empty
`items`, never a 500. Invalid numbers/enums return 400 through the global validation pipe.

### `GET /holidays/:slug`
```json
{ "package": Package, "related": [PackageCard], "currency": "AED" }   // related: same destination or theme, max 6, excludes itself
```
404 `{ "message": "Holiday package not found" }` for unknown/unpublished slugs.

### Admin (Bearer token; roles `content`, `admin`, `super_admin`)
- `POST /holidays` create (body = Package without `id`/`updatedAt`; `slug` optional, generated from title; `published` default true)
- `PATCH /holidays/:id` partial update
- `DELETE /holidays/:id` removes the package
- `GET /holidays/admin/all` lists every package including unpublished/sample, same paging as `GET /holidays`
Validation via class-validator DTOs (whitelist + forbidNonWhitelisted). Slugs are unique.

Banners and collections are seeded/managed in the database (collections `holiday_banners`, `holiday_collections`);
admin endpoints for them are out of scope for this iteration but the schemas must carry `order` and `published`.

## Storage (MongoDB via Mongoose, same conventions as `catalog`)

- `holidays` (`Holiday` schema): `slug` unique, `title`, `summary`, `description`, `destinations[]` (indexed), `country` (indexed),
  `durationNights`, `durationDays`, `price`, `salePrice`, `images[]`, `highlights[]`, `inclusions[]`, `exclusions[]`,
  `itinerary[]`, `themes[]` (indexed), `collections[]` (indexed), `rating` (optional), `popularity` (number, default 0, used by
  `sort=popular`), `published` (default true), `isSample` (default false), timestamps. Text index on title/summary/destinations/themes.
- `holiday_collections`: `slug` unique, `title`, `subtitle`, `order`, `published`.
- `holiday_banners`: `title`, `eyebrow`, `subtitle`, `description`, `image`, `ctaLabel`, `ctaHref`, `order`, `published`.

## Frontend routes (Next.js, app/(market))
- `/holidays` landing (banners, cities, countries, collections, recently viewed, trust section)
- `/holidays/destination/[name]` listing for one city (also supports `?country=`), filters/sort from facets
- `/holidays/[slug]` package detail

## Implementation notes (clarifications, no field renames)

- `GET /holidays/admin/all` items are `PackageCard` plus `published` and `isSample`. Filters/sort/paging match `GET /holidays`; `facets` are computed over all packages.
- `POST` and `PATCH` return the `Package` shape plus `published` and `popularity`; `isSample` is always included. `durationDays` defaults to `durationNights + 1`. Duplicate slug returns 409; unknown id returns 404; a malformed `:id` returns 400.
- `DELETE /holidays/:id` returns `{ "id": "<id>", "deleted": true }`.
- `slug` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (max 80). Image `url` must start with `/` or `https://`.
- `GET /holidays/:slug` accepts an optional `currency` query which is echoed. `isSample` is only present on the public `package` outside production.
- `q` uses a MongoDB text index (whole-word matching, stemmed), not substring matching. `destination`, `country`, `theme` and `collection` are exact, case-sensitive matches against facet values.
- `page` max 1000, `limit` 1..48, `minNights`/`maxNights` 0..60. Packages without a price sort last for both price sorts.
- Home `cities` and `countries` are capped at 24 entries each, banners at 10, collections at 12.
