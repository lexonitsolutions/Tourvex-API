# Visas API contract

Source of truth for the Visas feature. The NestJS API implements it; the Next.js site (`Tourvex-NextJS`) consumes it.
Base URL `/api/v1`. Read endpoints are **public** (`@Public()`). Prices are stored in **AED**; no currency conversion
(the `currency` query is accepted and echoed, like catalog/holidays).

## Content rules (important)

- Content is **our own**. Nothing is scraped or copied from another company's site (fees, processing times, requirements,
  copy and photos belong to their owners).
- **Visa facts must be verified before launch.** The seed ships *sample* visa products (`isSample: true`) with generic,
  deliberately cautious wording and indicative service fees. Every sample is hidden from public endpoints when
  `NODE_ENV=production` unless `HOLIDAYS_ALLOW_SAMPLES`-style flag `VISAS_ALLOW_SAMPLES=true` is set. Real products are loaded
  through admin endpoints or `npm run seed:visas -- --file <json>`.
- `price` is *our service fee* ("from"), not the government fee. Pages say fees and requirements are indicative.
- No fake ratings/reviews/statistics anywhere.

## Types

```ts
type Money = { amount: number; currency: string };      // "AED"

type VisaCard = {
  id: string; slug: string;
  country: string;               // "Türkiye"
  countryCode: string;           // ISO 3166-1 alpha-2, lowercase: "tr" (flag file /flags/tr.svg)
  title: string;                 // "Türkiye e-Visa"
  kind: "evisa" | "embassy";     // evisa = online; embassy = longer process via embassy/consulate
  startingPrice: Money | null;   // our service fee
  processing: string;            // short label, e.g. "3-5 working days"
  validity: string;              // short label, e.g. "Up to 30 days"
};

type Visa = VisaCard & {
  summary: string;
  description: string;           // paragraphs separated by \n\n
  entries: "single" | "multiple" | "varies";
  stay: string;                  // e.g. "Up to 30 days per visit"
  highlights: string[];
  requirements: string[];        // eligibility / general requirements
  documents: string[];           // documents the traveller provides
  steps: { title: string; description: string }[];      // how it works (3-5 steps)
  faqs: { question: string; answer: string }[];
  notes: string;                 // short disclaimer shown on the page ("Indicative, confirm at enquiry")
  sections: string[];            // section slugs
  isSample?: boolean;            // only outside production
  updatedAt: string;
};

type Banner = { id: string; eyebrow?: string; title: string; subtitle: string; description: string;
                countryCode: string; ctaLabel: string; ctaHref: string };      // ctaHref e.g. "/visas/uae-evisa"
type Section = { slug: string; title: string; subtitle: string; items: VisaCard[] };
```

## Endpoints

### `GET /visas/home`
`{ banners: Banner[], sections: Section[], currency }` — ordered, published only, empty sections omitted.

### `GET /visas`
Query: `q` (country/title text, case-insensitive substring on country and title), `kind` (`evisa|embassy`), `country` (exact),
`sort` (`popular` default | `price_asc` | `price_desc` | `name`), `page` (1), `limit` (default 24, max 60), `currency`.
`{ items: VisaCard[], pagination: {page,limit,total,pages}, facets: { kinds: [{name,count}] }, currency }`.
Unknown values give empty `items`; bad numbers/enums give 400.

### `GET /visas/:slug`
`{ visa: Visa, related: VisaCard[], currency }` (related: same kind, max 6, excludes itself). 404 `{message:"Visa not found"}`.

### Enquiries (lead capture, real, no payments)
- `POST /visas/:slug/enquiries` **public**, strictly throttled (5 per minute per IP via `@Throttle`). Body:
  `{ fullName (2-120), email, phone (6-20, digits/+/-/spaces), nationality (2-80), travellers (int 1-20), travelDate? (ISO date, not in the past), message? (<=1000), consent: true }`
  (`consent` must be `true`; unknown fields 400). If a valid Clerk bearer token is present the enquiry is linked to the local user
  (optional; never required). Returns `201 { id, reference, status: "new" }` (`reference` like `VQ-` + 8 uppercase base32 chars).
  404 for unknown/unpublished visa.
- `GET /visas/enquiries/admin` roles `sales, support, admin, super_admin`: paged list (`status`, `page`, `limit`), newest first.
- `PATCH /visas/enquiries/:id` same roles: body `{ status: "new"|"contacted"|"closed", note? }`; 400 malformed id, 404 missing.
Personal data note: store only what is listed; never log email/phone.

### Admin catalog (Bearer; roles `content, admin, super_admin`)
`POST /visas`, `PATCH /visas/:id`, `DELETE /visas/:id`, `GET /visas/admin/all` (includes unpublished/sample; same paging as `GET /visas`).
Routes `home`, `admin/all`, `enquiries/admin` must be declared before `:slug`.

## Storage (Mongoose, same conventions as `src/holidays`)
- `visas`: slug unique, country (indexed), countryCode, title, kind (indexed), summary, description, startingPrice, processing, validity,
  entries, stay, highlights[], requirements[], documents[], steps[], faqs[], notes, sections[] (indexed), popularity (default 0),
  published (true), isSample (false), timestamps; text index on country/title/summary.
- `visa_sections`: slug unique, title, subtitle, order, published.
- `visa_banners`: title, eyebrow, subtitle, description, countryCode, ctaLabel, ctaHref, order, published.
- `visa_enquiries`: visaId, visaSlug, reference unique, fullName, email, phone, nationality, travellers, travelDate?, message?,
  consentAt (Date), userId? (local user), status (default "new"), note?, timestamps; index on status+createdAt.

## Frontend routes (`app/(market)`)
- `/visas`: banner carousel, country finder (search), sections of country visa cards, "how it works" band, FAQ-free.
- `/visas/[slug]`: detail (overview, highlights, requirements, documents, steps, FAQs accordion, sticky price + "Start enquiry" form that
  posts to the enquiry endpoint, success state with the reference).
