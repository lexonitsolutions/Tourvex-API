# Events API contract

Source of truth for the Events feature (concerts, sports, festivals, comedy, family shows, theatre, exhibitions). NestJS implements it, the Next.js
site (`Tourvex-NextJS`) consumes it. Base URL `/api/v1`. Read endpoints are **public** (`@Public()`). Prices are stored in **AED**; currency
conversion is done by the global `CurrencyInterceptor` (see `docs/CURRENCY_API.md`; add `events` to its route allow-list and make sure
`enquiries` stays excluded). The module itself always returns AED.

## Content rules (important)
- Content is **our own**. Nothing is scraped or copied from another company's site, and no third-party photos are used or hotlinked.
- **No real artists, teams, shows, brands or venues in sample data.** Samples use FICTIONAL names ("Skyline Night Live", "Harbour Arena",
  "Coastline Music Weekender") so the site never presents invented events as if a real promoter staged them. Samples are `isSample: true` and hidden
  from public endpoints when `NODE_ENV=production` unless `EVENTS_ALLOW_SAMPLES=true`. Real events are loaded via admin endpoints or
  `npm run seed:events -- --file <json>`.
- Images: only files that already exist in the frontend's `public/images` (e.g. `/images/destination-a.jpg`, `/images/a1.jpg` ...); the seed
  rotates through them. Admin-supplied URLs must be `/images/...` or `https://`.
- No real-time inventory, no payments: pages show an indicative "from" price per ticket and the visitor sends an **enquiry** (lead capture) that our
  team answers. Never claim "sold out", "only N left", ratings, reviews or guarantees.
- **Dates are never stale:** only sessions on or after "today" (server date, UTC) are returned. Sample seed generates dates relative to the seed
  date (several events per week over ~4 months) so a re-seed refreshes them. An event with no upcoming session is still returned by
  `GET /events/:slug` (with `sessions: []`) but is excluded from `home` and list endpoints.

## Types
```ts
type Money = { amount: number; currency: string };           // "AED"

type EventCard = {
  id: string; slug: string; title: string;
  coverImage: string;
  category: string;                    // "Concerts" | "Sports" | "Festivals" | "Comedy" | "Family" | "Theatre" | "Exhibitions"
  venue: string; city: string; country: string;
  nextDate: string;                    // ISO datetime of the next upcoming session, e.g. "2026-11-14T19:30:00.000Z"
  sessionCount: number;                // upcoming sessions
  durationMinutes: number | null;
  price: Money | null;                 // lowest ticket "from" price
  tags: string[];                      // e.g. ["Family friendly", "Outdoor"]
};

type Event = EventCard & {
  summary: string;
  description: string;                 // paragraphs separated by \n\n
  images: { url: string; alt: string }[];
  sessions: { id: string; startsAt: string; doorsOpenAt?: string }[];   // upcoming, ascending, max 60
  ticketTypes: { type: string; description: string; price: Money | null }[];   // 2-4
  highlights: string[]; inclusions: string[]; exclusions: string[];
  ageGuidance: string;                 // e.g. "All ages", "18+"
  venueAddress: string;
  notes: string;                       // disclaimer
  isSample?: boolean; updatedAt: string;
};

type Banner = { id: string; eyebrow?: string; title: string; subtitle: string; description: string; image: string; ctaLabel: string; ctaHref: string };
type CategoryCard = { name: string; slug: string; count: number; image: string; startingFrom: Money | null };
type CityCard = { name: string; country: string; count: number; image: string; startingFrom: Money | null };
type Section = { slug: string; title: string; subtitle: string; city?: string; category?: string; items: EventCard[] };
```

## Endpoints
### `GET /events/home`
`{ banners, categories: CategoryCard[], cities: CityCard[], sections: Section[], currency }`
- `categories`: categories with upcoming events, most events first (image = cover of its most popular event). `slug` is the lower-case slug of the name.
- `cities`: cities with upcoming events, most first.
- `sections` (each up to 12 cards, only non-empty): first **"Happening soon"** (slug `happening-soon`, next 30 days, soonest first), then **"Trending in <city>"** for the top 3 cities
  (slug `trending-<city-slug>`, by `popularity` desc, `city` set).

### `GET /events`
Query: `q` (title/venue/city/tags, case+diacritic-insensitive), `city`, `category` (name or slug), `date` (`YYYY-MM-DD`, events with a session that day), `from`/`to` (`YYYY-MM-DD` range),
`sort` (`soonest` default | `popular` | `price_asc` | `price_desc`), `page` (1), `limit` (default 12, max 48), `currency`.
`{ items: EventCard[], pagination, facets: { cities: [{name,count}], categories: [{name,slug,count}], months: [{name:"2026-11",count}] }, currency }`
Facets are over all visible events with an upcoming session. Unknown values give empty `items`; bad dates/enums/numbers give 400.

### `GET /events/:slug`
`{ event: Event, related: EventCard[], currency }`; related = same city or category, max 6, excludes itself. 404 `{message:"Event not found"}`.

### Enquiries (lead capture)
- `POST /events/:slug/enquiries` **public**, throttled 5/min/IP. Body `{ fullName (2-120), email, phone (6-20), tickets (int 1-20), ticketType? (<=60), sessionId? (must be one of the event's upcoming sessions),
  message? (<=1000), consent: true }` (unknown fields 400). Optional Clerk token links `userId` (never required). Returns `201 { id, reference, status:"new" }`, `reference` = `EQ-` + 8 base32 chars. 404 unknown/unpublished.
- `GET /events/enquiries/admin` roles `sales, support, admin, super_admin` (paged, `status`); `PATCH /events/enquiries/:id` same roles `{ status: "new"|"contacted"|"closed", note? }`.
No PII in logs; never echo personal data beyond `{id, reference, status}`.

### Admin catalog (roles `content, admin, super_admin`)
`POST /events`, `PATCH /events/:id`, `DELETE /events/:id`, `GET /events/admin/all`. Static routes (`home`, `admin/all`, `enquiries/admin`) before `:slug`. Slug unique (409). Past sessions rejected (400).

## Storage (Mongoose, same conventions as `src/cruises`)
`events` (slug unique, title, summary, description, category (idx), venue, venueAddress, city (idx), country, durationMinutes, sessions[{startsAt (idx), doorsOpenAt}], ticketTypes[], images[], highlights/inclusions/exclusions,
ageGuidance, notes, tags, price, popularity, published, isSample, timestamps; text index title/venue/city/tags), `event_banners`, `event_enquiries` (eventId, eventSlug, reference unique, fullName, email, phone, tickets, ticketType?, sessionId?, message?, consentAt, userId?, status, note?, timestamps).

## Frontend routes (`app/(market)`)
- `/events`: hero carousel (same hero component pattern as Holidays/Cruises), "Explore by category" rail, "Explore events by city" rail, section rails (Happening soon, Trending in <city>), "Why book with us" band (honest qualitative points), closing CTA.
- `/events/category/[category]` and `/events/city/[city]` may both be served by one listing page component with filters (category, city, date range, sort), load more. Choose routes `/events/in/[city]` and `/events/category/[slug]`.
- `/events/[slug]`: gallery, summary, sessions picker, ticket types with from prices, highlights, inclusions/exclusions, venue + age guidance, related, sticky price card + "Request tickets" enquiry sheet.

## Implementation notes
- `EventCard.nextDate` is `null` (not a string) when an event has no upcoming session; this can only happen on `GET /events/:slug` and the admin list, never on `home` or the public list.
- Session ids are the Mongo `_id` of the session sub-document. The seed derives them from slug + start time so they survive a re-seed; sessions edited through `PATCH /events/:id` are replaced wholesale and get new ids.
- "Upcoming" is on or after the start of today (UTC), matching cruises, so a session earlier today still counts. "Happening soon" covers sessions from the start of today to now + 30 days.
- `GET /events` with `date`, `from` or `to` restricts matching to events with a session inside that window (never before today); `sort=soonest` still orders by the event's next upcoming session overall. `from`/`to` are inclusive days.
- `category` filter accepts the canonical name or its slug, case-insensitively; admin `category` must be one of the seven names.
- Admin `POST /events` requires 2-4 `ticketTypes`; `sessions` are optional (max 60, start day not in the past, `doorsOpenAt` not after `startsAt`). `PATCH` accepts any subset.
- Error bodies use the standard Nest shape (`{ message, error, statusCode }`), as the other modules do; `message` is `"Event not found"` for 404s.
- `GET /events/enquiries/admin` and `PATCH /events/enquiries/:id` are excluded from currency conversion by the shared `enquiries`/`admin` segment rules.
