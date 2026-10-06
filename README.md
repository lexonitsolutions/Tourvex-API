# Tourvex API and CRM

NestJS 12 / Node.js 24 API for Tourvex. It provides customer and B2B identity, role-based access, activity catalog migration, mocked travel suppliers, CRM inventory, server-side partner pricing, bookings, Stripe payments, cancellation decisions and invoice generation.

The controlling delivery scope and data rules are in [docs/PRODUCTION_PLAN.md](docs/PRODUCTION_PLAN.md).

## Local setup

```powershell
docker compose up -d
npm install
npm run seed:media
npm run build
npm run seed:activities
npm run start:dev
```

- API: `http://localhost:4100/api/v1`
- Swagger UI: `http://localhost:4100/api/v1/docs`
- OpenAPI JSON: `http://localhost:4100/api/v1/openapi.json`
- Mailpit: `http://localhost:8025`
- MinIO console: `http://localhost:9001`

MongoDB, Redis and Mailpit start in the default profile. Object storage is optional locally; start it with `docker compose --profile storage up -d` when the MinIO Quay registry is reachable.

The checked-in `.env.example` documents every setting. `.env` is local-only and ignored by Git. Mock suppliers and mock payment confirmation are enabled locally. Set `PAYMENTS_MOCK=false` and provide Stripe secrets only after configuring a Stripe test account and webhook endpoint.

## Authentication (Clerk)

Sign-up, sign-in, password reset, refresh and sign-out are handled by **Clerk** on the website (`@clerk/nextjs`). The API issues no passwords or tokens of its own.

1. The browser gets a short-lived Clerk session token with `getToken()` and sends it as `Authorization: Bearer <token>`.
2. The global `ClerkAuthGuard` verifies it with `@clerk/backend` (`CLERK_SECRET_KEY`, and the token's `azp` must be one of `CLERK_AUTHORIZED_PARTIES`, which defaults to the `FRONTEND_URL` origins). Routes marked `@Public()` skip this. Invalid or expired tokens get a generic `401`.
3. The Clerk user is mapped to the **local** user record, which keeps our roles, status and B2B partner approval. On first sight the API provisions it just in time: a Clerk user whose **verified** primary email matches an existing local user is linked to it (keeping its roles); otherwise a new active `customer` is created. An unverified email never links to an existing account. Users that are `pending` or `suspended` get `403 Account is not active`.
4. `request.user.sub` (and `@CurrentUser()`) is the local MongoDB user id; the Clerk id is available as `clerkUserId`. `GET /api/v1/auth/me` returns the local profile.

Resolved users are cached in memory per process for 60 seconds. Role, status and partner-approval changes made through the API invalidate the cache immediately on that instance; other instances catch up within 60 seconds.

**B2B partners.** Clerk has no account types, so partners apply after signing in: `POST /api/v1/users/me/partner-application` (`companyName`, optional `phone`, `website`, `message`). Admins review with `PATCH /api/v1/users/:id/partner-application` (`{ "decision": "approved" | "rejected", "note"? }`); approval adds the `b2b_owner` role. A rejected applicant may apply again.

**Granting admin.** Set `SEED_ADMIN_EMAIL` in `.env` and run `npm run seed:admin`. It upserts an active local user with the `super_admin` role (no password). When that person signs up or signs in with Clerk using the same email, and the email is verified, the API links the Clerk account to that record on the first request. After that, a super administrator can change anyone's roles with `PATCH /api/v1/users/:id/roles`.

**Bootstrapping the first admin (admin platform).** Run `npm run seed:staff -- --email owner@example.com [--name "Owner Name"]`. It creates, or updates, exactly one local user with the roles `customer` and `super_admin`, active, matched by email (unique index plus a single upsert, so repeating it never creates duplicates and never touches other fields of an existing user). It takes no secrets, sets no password and makes no Clerk call. The owner then signs in on the website with Clerk using that same, verified email and the API links the account on the first request; from there `/admin` works and further staff are created in the admin UI (`POST /api/v1/admin/staff`). Existing users are never duplicated because provisioning always looks the local user up by email first.

**Admin platform (Phase 0).** The contract is in `docs/ADMIN_PLATFORM.md`. Permissions (`<module>.<action>`) are derived from roles in the single file `src/admin/permissions.ts` and enforced by `@RequirePermission()`; `GET /api/v1/admin/me` returns the staff profile, permissions and a server-built menu. Staff mutations and settings changes are written to the immutable `audit_logs` collection (`GET /api/v1/admin/audit`); caller IPs are stored only as a salted hash (set `AUDIT_IP_SALT` to a long random value in production). Staff can be deactivated (`active: false` on the user): they then get `403` on every route, including public routes that enrich the request when signed in. Site settings live in `site_settings` (`GET/PUT /api/v1/admin/settings/:group`, public subset at `GET /api/v1/settings/public`); the tax percent, cart hold minutes and FX markup are read through `SettingsService` (60 second cache) and fall back to `CHECKOUT_TAX_PERCENT`, `CHECKOUT_HOLD_MINUTES` and `FX_MARKUP_PERCENT` until a value is saved.

**Configuration.** `CLERK_SECRET_KEY` is required when `NODE_ENV=production`. In other environments the API boots without it, logs a warning and answers `401` on every protected route. `CLERK_PUBLISHABLE_KEY` is optional for the API. `CLERK_AUTHORIZED_PARTIES=*` turns off the `azp` check and is accepted only when `NODE_ENV=test`, because Backend-API-minted test tokens carry no `azp`. Use the production Clerk instance keys (`sk_live_`) in production, and list the production website origins in `CLERK_AUTHORIZED_PARTIES` or `FRONTEND_URL`.

## Import the 220 activities

`npm run seed:activities` reads `../Tourvex-NextJS/app/data/activities.js`, maps the WordPress records into bilingual-ready MongoDB documents and upserts by slug. It is repeatable and reports created/updated counts.

## Import website media

`npm run seed:media` imports every supported file from `../Tourvex-NextJS/public/images` into the MongoDB `media` GridFS bucket. It is checksum-based and repeatable: unchanged files are skipped and changed files replace their previous database version. The frontend keeps its existing `/images/<filename>` URLs, but a `beforeFiles` rewrite proxies every request to `GET /api/v1/media/images/:filename`, so the browser receives the image from MongoDB rather than the Next.js public directory.

## Holidays

The holiday packages API (`/api/v1/holidays`, contract in `docs/HOLIDAYS_API.md`) is backed by the `holidays`, `holiday_collections` and `holiday_banners` collections. `npm run seed:holidays` upserts our own sample content (packages flagged `isSample: true`, 4 collections, 3 banners) and is repeatable. `npm run seed:holidays -- --file packages.json` imports real packages from a JSON array (`isSample` defaults to false) and reports validation errors per item.

Sample packages are hidden from every public endpoint when `NODE_ENV=production`, unless `HOLIDAYS_ALLOW_SAMPLES=true`. They are always visible in development and test.

## Visas

The visas API (`/api/v1/visas`, contract in `docs/VISAS_API.md`) is backed by the `visas`, `visa_sections`, `visa_banners` and `visa_enquiries` collections. `npm run seed:visas` upserts our own sample content by slug (24 products flagged `isSample: true`, 2 sections, 3 banners) and is repeatable. `npm run seed:visas -- --file visas.json` imports real products from a JSON array (`isSample` defaults to false), validates each item, reports errors per item and exits non-zero if any item failed.

Sample visas are generic placeholders with indicative service fees. They are hidden from every public endpoint when `NODE_ENV=production`, unless `VISAS_ALLOW_SAMPLES=true`; they are always visible in development and test. Replace them with verified, current visa information before launch.

`POST /api/v1/visas/:slug/enquiries` is public, limited to 5 requests per minute per IP, and requires `consent: true`. If the request carries a valid Clerk bearer token the enquiry is linked to the local user; an invalid, expired or missing token is silently ignored and never causes a 401. The response contains only `{ id, reference, status }`. Enquiry email and phone are stored for follow-up and are never logged. Staff (`sales`, `support`, `admin`, `super_admin`) list and update enquiries through `GET /visas/enquiries/admin` and `PATCH /visas/enquiries/:id`.

## Cruises

The cruises API (`/api/v1/cruises`, contract in `docs/CRUISES_API.md`) is backed by the `cruises`, `cruise_banners` and `cruise_enquiries` collections. `npm run seed:cruises` upserts our own sample content by slug (16 cruises flagged `isSample: true` that use FICTIONAL cruise lines and ships, plus 3 banners) and is repeatable. Departure dates are generated relative to the day the seed runs (several per month for about the next 8 months) and the `departures` array is replaced on every run, so re-seeding refreshes them. `npm run seed:cruises -- --file cruises.json` imports real cruises from a JSON array (`isSample` defaults to false), validates each item (including future-only departures and the itinerary rules), reports errors per item and exits non-zero if any item failed.

Only upcoming departures (on or after the start of today, UTC) are ever returned; cruises with none are left out of `home` and the list, and `GET /cruises/:slug` returns them with `departures: []`. Sample cruises are hidden from every public endpoint when `NODE_ENV=production`, unless `CRUISES_ALLOW_SAMPLES=true`; they are always visible in development and test. Fares are indicative and confirmed on enquiry. `POST /api/v1/cruises/:slug/enquiries` behaves like the visa one (public, 5 per minute per IP, `consent: true`, optional Clerk token linking, reference `CQ-XXXXXXXX`, response only `{ id, reference, status }`, no PII in logs); when `departureDate` is sent it must be one of the cruise's upcoming departures. Staff use `GET /cruises/enquiries/admin` and `PATCH /cruises/enquiries/:id`.

## Events

The events API (`/api/v1/events`, contract in `docs/EVENTS_API.md`) is backed by the `events`, `event_banners` and `event_enquiries` collections. `npm run seed:events` upserts our own sample content by slug (24 events flagged `isSample: true` across Concerts, Sports, Festivals, Comedy, Family, Theatre and Exhibitions in Dubai, Abu Dhabi, Sharjah, Doha and Riyadh, using FICTIONAL event names and venues, plus 3 banners) and is repeatable. Sessions are generated relative to the day the seed runs (UTC evenings between 18:00 and 21:30, several events per week for about the next four months, some multi-night runs) and the `sessions` array is replaced on every run, so re-seeding refreshes them; session ids are derived from the slug and start time, so they stay stable across re-seeds. Images only reference files that already exist in the frontend's `public/images`. `npm run seed:events -- --file events.json` imports real events from a JSON array (`isSample` defaults to false), validates each item (including future-only sessions), reports errors per item and exits non-zero if any item failed.

Only upcoming sessions (on or after the start of today, UTC) are ever returned; events with none are left out of `home` and the list, and `GET /events/:slug` returns them with `sessions: []` and `nextDate: null`. Sample events are hidden from every public endpoint when `NODE_ENV=production`, unless `EVENTS_ALLOW_SAMPLES=true`; they are always visible in development and test. Prices are indicative per ticket and confirmed on enquiry; there is no inventory or payment. `events` is on the currency interceptor's allow-list (`?currency=USD` converts the home, list and detail responses), while the enquiry and admin routes are never converted. `POST /api/v1/events/:slug/enquiries` behaves like the cruise one (public, 5 per minute per IP, `consent: true`, optional Clerk token linking, reference `EQ-XXXXXXXX`, response only `{ id, reference, status }`, no PII in logs); when `sessionId` is sent it must be one of the event's upcoming sessions. Staff use `GET /events/enquiries/admin` and `PATCH /events/enquiries/:id`; the catalog is managed through `POST/PATCH/DELETE /events` and `GET /events/admin/all`.

## Partners

The partners API (`/api/v1/partners`, contract in `docs/PARTNERS_API.md`) powers the "In Partnership with World-Class Attractions" strip on the home and activities pages, backed by the `partners` collection. `GET /partners` is public (`placement=home|activities`, `limit` up to 48, cached for 5 minutes) and returns `items: []` when nothing is visible, so the site hides the section. Staff (`content`, `admin`, `super_admin`) manage partners through `POST /partners`, `PATCH /partners/:id`, `DELETE /partners/:id` and `GET /partners/admin/all`; `logo` must be `/images/...` or `https://...` and `href` must be `https://...`.

A partnership is a real-world claim, so `npm run seed:partners` only upserts (by name, repeatable) 10 clearly FICTIONAL sample attractions with `logo: null` and `isSample: true`; they imply no real partnership. Real partners are loaded with the admin endpoints or `npm run seed:partners -- --file partners.json` (a JSON array validated like the admin API; `isSample` defaults to false). Their logos must be supplied by the business, which must have the right to show them. Samples are hidden when `NODE_ENV=production` unless `PARTNERS_ALLOW_SAMPLES=true`, so in production the section stays hidden until real partners exist.

## Activity detail, availability, cart checkout and reviews

The contract is `docs/ACTIVITY_BOOKING_API.md` (including its cart amendment); deviations and decisions are listed in its "Implementation notes" section.

- **Details and options.** `GET /api/v1/catalog/activities/:slug` returns the optional detail fields and `options` only when they exist, plus `rating` (computed from published reviews, `null` when there are none). Activities without `options` are enquiry-only. The activity list omits all detail fields. Staff (`content`, `admin`, `super_admin`) edit them with `PATCH /catalog/activities/:id/details`.
- **Availability and quote.** `GET /catalog/activities/:slug/availability?optionId=&month=YYYY-MM` and `POST /catalog/activities/:slug/quote` (30 per minute per IP) are public. Capacity is `dailyCapacity` minus travellers (adults + children) in confirmed bookings, unexpired `pending_payment` bookings and unexpired open carts. Service days are calendar days in Asia/Dubai.
- **Cart and checkout.** `src/checkout` implements the one-cart-per-user flow under `/api/v1/checkout/cart/*` (add/modify/remove items, pick-up, additional details, customer, promo, pay, status) and `GET /checkout/sessions/:id[/status]`. Every route needs a Clerk token. Prices are computed on the server only; taxes come from `CHECKOUT_TAX_PERCENT`, the cart window from `CHECKOUT_HOLD_MINUTES`. Expired carts are cleaned up lazily on read and by an unref'd sweep every `CHECKOUT_SWEEP_SECONDS` (disabled when `NODE_ENV=test`). `/checkout`, `/bookings` and `/payments` are never converted by the currency interceptor; checkout responses are AED with an indicative `pricing.display` when `?currency=` is sent.
- **Payments.** `POST /checkout/cart/pay` creates one order (`OR-XXXXXXXX`), one booking per item and one payment for the total. With `PAYMENTS_MOCK=true` the order is confirmed immediately. With Stripe it returns the PaymentIntent `clientSecret`; the existing `POST /payments/stripe/webhook` confirms every booking of the order on `payment_intent.succeeded` (the amount must equal the order total). `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PUBLISHABLE_KEY` come from `.env`; the API only reports whether the publishable key is configured. No card data is ever received or logged. Confirmation e-mails go through a stub (`src/notifications`) that logs booking references only.
- **Reviews.** Customers with a confirmed booking whose service day has passed review once per booking (`POST /catalog/activities/:slug/reviews`, created `pending`). Staff (`admin`, `super_admin`, `support`, `content`) moderate with `GET /catalog/reviews/admin` and `PATCH /catalog/reviews/:id`. Only published reviews are public.
- **Promo codes.** Staff (`admin`, `super_admin`, `content`) manage them at `/checkout/promos`; `usedCount` increases when an order is paid.
- **Seed.** `npm run seed:activity-details` adds ORIGINAL sample details and 1-3 options to eight existing activities (flagged `detailsAreSample: true`) and two sample promo codes (`WELCOME10`, `SAVE50`, flagged `isSample`). It is repeatable and prices come from each activity's own listed price. `npm run seed:activity-details -- --file details.json` imports real data from a JSON array of `{ "slug": "...", ...detail fields }` (validated like the admin endpoint, `detailsAreSample` defaults to false). Sample details, options and promo codes are hidden in production unless `ACTIVITY_SAMPLE_DETAILS=true`.

## Operations: bookings, vouchers, finance

Staff-side bookings, refunds, vouchers with QR and the finance/invoice tooling live under `/api/v1/admin/bookings`, `/admin/vouchers`, `/admin/finance` and `/admin/invoices`. The endpoint contract, rules and implementation notes are in `docs/ADMIN_OPERATIONS.md`.

- `GET /bookings` (customer route) now only returns the caller's own bookings, for every role; staff use `/admin/bookings`.
- Every confirmed booking gets a voucher (random 16-character base32 code, QR = `<FRONTEND_URL>/v/<code>`) and an invoice (`INV-YYYY-000001`). `npm run backfill:vouchers` issues both for bookings confirmed before this existed (idempotent).
- Refunds go to Stripe when the payment was a real PaymentIntent and are simulated for `PAYMENTS_MOCK` payments; every refund is a ledger row plus a credit note (`CN-YYYY-000001`).
- Invoice PDFs use the company details of Settings > General (`legalName`, `address`, `taxNumber`).

## Verification

```powershell
npm run lint
npm test
npm run build
npm run test:playwright
```

Playwright covers health, activity details/availability/quotes, checkout and review authorisation, the cart-to-booking flow (authenticated, mock payments), activity details/availability/quotes, checkout and review authorisation, the cart-to-booking flow (authenticated, mock payments), supported languages/currencies, holidays, visas (including enquiries and the 429 throttle; the enquiry tests skip if a run in the last minute used the rate-limit window), all five mocked supplier verticals and authentication. The authenticated tests use a real Clerk **development** instance. They create a throwaway Clerk user through the Backend API, mint a session token, call the API and delete the user afterwards. They run only when `CLERK_SECRET_KEY` (from the environment or `.env`) is an `sk_test_` key, and the API under test is started with `NODE_ENV=test` and `CLERK_AUTHORIZED_PARTIES=*`, as the Playwright `webServer` does. Otherwise they are skipped with a reason. Jest needs `--experimental-vm-modules` to load the ESM-only NestJS 12 packages, and `npm test` already passes it.

## Production image flow

Tag `api-v*` or manually run `.github/workflows/deploy.yml`. CI builds an immutable image tagged with the Git SHA, pushes it to DigitalOcean Container Registry, connects to the production host, pulls that exact image and restarts only the API service. Production secrets remain on the host or in the deployment secret store.

## Admin CRM (leads, tickets, customers, partners)

Unified leads CRM, support tickets with SLA targets (`site_settings` group `support`), customers and B2B partner review live under `/api/v1/admin/...`; public `POST /contact`, `POST /catalog/activities/:slug/enquiries` and the customer `/tickets` API feed them. Every site enquiry also creates a lead. Import existing enquiries once with `npm run leads:backfill` (add `-- --dry-run` first). Contract and decisions: `docs/ADMIN_CRM.md`.

### Admin dashboard and reports

`GET /api/v1/admin/dashboard?range=7d|30d|90d|ytd` (or `from`/`to`, max 366 days) returns permission-filtered KPIs, previous-period comparisons, daily Asia/Dubai series, breakdowns, activity and rule-based insights (AED only, real data only); `/admin/reports/{sales,top-activities,lead-funnel,support,cancellations}` plus `/export.csv` for each. Formulas, permissions and tests: `docs/ADMIN_REPORTS.md`.
