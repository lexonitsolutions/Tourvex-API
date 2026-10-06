# Activity detail, availability, checkout and reviews: contract

Scope: the flow of an activity page (`/activities/[slug]`) → pick travellers + date → check availability → 4-step checkout (pick-up, additional
details, customer details, payment) → confirmation. NestJS implements it, Next.js (`Tourvex-NextJS`) consumes it. Base URL `/api/v1`.
Builds on existing modules: `catalog` (activities), `bookings`, `payments` (Stripe + `PAYMENTS_MOCK`), `users`, `currency`. Prices are stored and **charged in AED**;
display currency conversion is done by the existing `CurrencyInterceptor` for GET catalog routes only (checkout/booking/payment routes stay AED; the UI says
"Your card will be charged in AED" and may show the selected-currency equivalent as an indicative figure computed by the API, see `display`).

## Content rules
- Never invent facts. Detail blocks (operating hours, languages, highlights, inclusions, how to redeem, reviews, map, etc.) render only when the data exists.
  Existing catalog items only have title/price/images/categories/destinations. A seed enriches ~8 activities with ORIGINAL sample details flagged
  `detailsAreSample: true` (hidden in production unless `ACTIVITY_SAMPLE_DETAILS=true`); real details are loaded via admin endpoints or `--file` import.
- **No fake reviews, ratings, "sold out", "only N left" or urgency.** Reviews come only from real customers (see Reviews). Rating summary is computed from them; with none, the UI shows nothing.
- No card data ever touches our servers or logs: card entry uses Stripe Elements (client secret from our API). `PAYMENTS_MOCK=true` keeps working for dev (no keys).
  Secrets (`STRIPE_*`) are supplied by the owner in `.env`; code never reads/prints them.
- Server is the authority on prices, availability, promo and totals; the client never sends amounts.

## Activity detail (extend `GET /catalog/activities/:slug`)
Existing fields stay. Add optional fields (all absent when unknown):
```ts
type ActivityDetail = Activity & {
  gallery?: { url: string; alt: string }[];                // 1-12
  operatingHours?: string;                                  // "Approx 08:30 am - 02:30 pm"
  instantConfirmation?: boolean;
  mobileVoucher?: boolean;
  freeCancellationHours?: number | null;                    // e.g. 24; null/absent = non refundable
  languages?: string[];
  description?: string;                                     // paragraphs separated by \n\n
  highlights?: string[]; inclusions?: string[]; exclusions?: string[];
  howToRedeem?: string[]; importantInfo?: string[];
  location?: { name: string; address: string; lat?: number; lng?: number };
  duration?: string;                                        // display text
  options?: ActivityOption[];                               // bookable variants
  rating?: { average: number; count: number; breakdown: { excellent: number; veryGood: number; average: number; poor: number; terrible: number } } | null;
  detailsAreSample?: boolean;                               // outside production only
};
type ActivityOption = {
  id: string; name: string;                                 // "Classical Dubai City Tour"
  transferType: 'sharing' | 'private' | 'none';
  startTime?: string;                                       // "06:00" display text
  durationLabel?: string;
  adultPrice: Money; childPrice?: Money | null; childAgeRange?: string;   // e.g. "3-11 years"
  minPax: number; maxPax: number;                           // per booking
  pickupRequired: boolean;                                  // drives the pick-up step
  freeCancellationHours?: number | null; refundable: boolean;
  operatingWeekdays: number[];                              // 0=Sun..6=Sat
  blackoutDates?: string[];                                 // ISO dates
  dailyCapacity?: number | null;                            // null = unlimited
  cutoffHours?: number;                                     // booking cut-off before start
};
```
`salePrice`/was-price semantics stay at activity level; option prices are the authoritative per-pax prices for booking. Activities without `options` are
**enquiry-only** on the site (existing behaviour: link to `sourceUrl`), never bookable.

### `GET /catalog/activities/:slug/availability?optionId=&month=YYYY-MM`
`{ optionId, month, currency:"AED", days: [{ date:"2026-10-05", status:"available"|"sold_out"|"non_operational"|"past", adultPrice?: Money, childPrice?: Money|null }], nextAvailable?: "2026-10-05", thisWeekend?: "2026-10-09" }`
Computed from operatingWeekdays, blackoutDates, cutoffHours, `dailyCapacity` minus quantities in `confirmed` and unexpired `pending_payment` bookings/holds for that option+date. 400 on bad month/optionId, 404 unknown.

### `POST /catalog/activities/:slug/quote` (public, throttled 30/min)
Body `{ optionId, date, adults (1..), children (0..) }` → `{ lines: [{label:"1 adult x", unit: Money, qty, total: Money}], subtotal, discount: Money, taxesAndFees: Money, total: Money, currency:"AED", refundable, freeCancellationUntil?: ISO, display?: {currency, total} }`.
Validates availability, pax limits (minPax/maxPax), child allowed, date window. 400/409 with clear messages (`DATE_UNAVAILABLE`, `PAX_LIMIT`, ...). Taxes follow config `CHECKOUT_TAX_PERCENT` (default 5; shown as "Taxes & fees", included in the total, never hidden).

## Checkout sessions (authenticated: Clerk user via existing guard; customer provisioned by email)
A session is a draft order for ONE option/date/travellers, held for `CHECKOUT_HOLD_MINUTES` (default 10) counting against capacity; expires lazily/at read.
- `POST /checkout/sessions` body `{ activitySlug, optionId, date, adults, children }` → `201 Session`. Recomputes price server side. Reuses the user's existing unexpired identical session (idempotent).
- `GET /checkout/sessions/:id` → `Session` (owner only; 404 otherwise); includes `expiresAt`, `steps` completion flags.
- `PATCH /checkout/sessions/:id/pickup` body `{ mode: "now"|"later", locationName?, address?, lat?, lng?, notes? }` (mode now requires locationName+address; only when option.pickupRequired).
- `PATCH /checkout/sessions/:id/additional` body `{ leadTravellerNames?: string[], specialRequests? (<=500), arrivalFlight? (<=40), hotelName? (<=120) }` (only free-text fields; strict whitelist).
- `PATCH /checkout/sessions/:id/customer` body `{ fullName (2-120), email, phoneCountryCode ("+971"), phone (digits 6-15), nationality (2-80), marketingOptOut: boolean }`.
- `POST /checkout/sessions/:id/promo` body `{ code }` → recalculated session or 400 `INVALID_PROMO`; `DELETE /checkout/sessions/:id/promo`. Promo codes in collection `promo_codes` (code upper-case unique, type percent|fixed, value, minSubtotal, maxDiscount, validFrom/To, usageLimit, usedCount, appliesTo activity slugs[] optional, published); admin CRUD (roles admin, super_admin, content) at `/checkout/promos`. Never reveal other codes.
- `POST /checkout/sessions/:id/pay` → requires all steps valid and unexpired; creates the Booking (status `pending_payment`) once (idempotent), then payment: stripe mode `{ mode:"stripe", bookingReference, clientSecret, paymentIntentId, publishableKeyConfigured:boolean }`; mock mode `{ mode:"mock", status:"succeeded", bookingReference }` (mock confirms booking immediately).
  Stripe: PaymentIntent amount = total AED minor units, metadata bookingId/reference; confirmation comes from the existing webhook (`payment_intent.succeeded` → booking `confirmed`, session `completed`, promo usedCount++, voucher email stub). Failure/expiry releases the hold.
- `GET /checkout/sessions/:id/status` → `{ status: "open"|"awaiting_payment"|"completed"|"expired", bookingReference?, bookingStatus? }` (poll after Stripe redirect).
```ts
type Session = {
  id: string; status: 'open'|'awaiting_payment'|'completed'|'expired'; expiresAt: string;
  activity: { slug: string; title: string; image: string; location?: string };
  option: { id: string; name: string; transferType: string; startTime?: string; pickupRequired: boolean; refundable: boolean; freeCancellationUntil?: string };
  date: string; adults: number; children: number;
  pricing: { subtotal: Money; discount: Money; taxesAndFees: Money; total: Money; currency: 'AED'; promoCode?: string; display?: { currency: string; total: Money } };
  pickup?: {...}; additional?: {...}; customer?: {...};
  steps: { pickup: boolean; additional: boolean; customer: boolean };
};
```
Cart: the header cart icon shows the user's open sessions count (`GET /checkout/sessions?status=open` → `{ items: Session[] }`, expired excluded). One activity per session in this version.

## Bookings (extend the existing module)
Booking gets the fields needed to render a voucher: option name, date, adults, children, pickup, additional, customer, price breakdown, free-cancellation deadline, `activitySlug`. Existing `GET /bookings`, `GET /bookings/:id` (id or reference), `POST /bookings/:id/cancellation` stay (cancellation request honours `freeCancellationUntil`; refunds are handled by staff, state it in the response message). Old `POST /bookings` (sku based) remains for non-activity services; it must not break.
Confirmation e-mail: no provider configured, so write a `notifications` stub (log reference only, no PII) behind an interface so a provider can be added later.

## Reviews
- `GET /catalog/activities/:slug/reviews?rating=&withImages=&sort=top|recent&page=&limit=` → `{ summary: {average,count,breakdown}|null, items: [{ id, displayName ("Alisa P."), rating 1-5, title, body, createdAt, images?: string[] }], pagination }`.
- `POST /catalog/activities/:slug/reviews` authenticated, only a user with a `confirmed` booking for that activity whose service date has passed; one review per booking; body `{ bookingReference, rating 1-5, title (<=100), body (10-2000) }`; created `pending` → moderated by staff (`PATCH /catalog/reviews/:id` roles admin/support/content: status published|rejected). Only `published` reviews are public. Display name is first name + last initial (no e-mail/phone exposed). Rating bands: >=4.5 excellent, 3.5-<4.5 veryGood, 2.5-<3.5 average, 1.5-<2.5 poor, <1.5 terrible.

## Admin
Catalog detail/option editing via `PATCH /catalog/activities/:id/details` (roles content, admin, super_admin) validating the types above (past blackout irrelevant). `npm run seed:activity-details` enriches ~8 popular activities with ORIGINAL sample details + 1-3 options each, idempotent, `--file` import for real data.

## Frontend routes (`app/(market)`)
- `/activities/[slug]` detail: breadcrumb (Home / Activities / <city> / <category> / title), title, location, wishlist + share, gallery grid (1 large + 4, "See more" lightbox), key facts row (operating hours, instant confirmation, mobile voucher, free cancellation, transfers, languages, map link), description, collapsible Highlights / Inclusions / Exclusions / How to redeem / Important information, location + map link (no Google embed unless coordinates exist; use a static OpenStreetMap link, no API keys), reviews block (only if real reviews), related activities, sticky booking card (travellers popover adults/children, date popover calendar with availability dots + "Next available"/"This weekend" shortcuts, price with was-price/save badge in the selected currency, "Check availability" → options list for the chosen date with per-option prices, "Proceed to pay" starts a checkout session; unauthenticated users are sent to sign-in then returned).
- `/checkout/[sessionId]` stepper: Back to booking · Pick-up location · Additional details · Customer details · Payment confirmation. Left: item summary card (image, badges: refundable, transfer type, start time, total, date, pax) + current step card; right: Trip Summary (subtotal, taxes & fees, total payable, "Your card will be charged in AED", why-book points that are honest/qualitative). Countdown of the hold. Payment step: promo code field, payment via Stripe Payment Element (cards; wallets only if the Payment Element offers them, no fake Apple/Google Pay/Etihad rows) or the mock confirmation when `mode:"mock"`; "Pay AED x" button, expiry handling, error states.
- `/bookings/[reference]` confirmation/voucher page (status, details, cancellation policy, "Request cancellation"), linked from the existing My Bookings list.

## AMENDMENT: cart with Review Cart step (supersedes "one activity per session")
The checkout stepper has FIVE steps: **1 Review Cart** · 2 Pick-up Location · 3 Additional Details · 4 Customer Details · 5 Payment Confirmation.
Step 1 shows "Your cart", items grouped under "Activities" (thumb, badges: refundable/non-refundable, transfer type, start time, per-item total, date, travellers,
**Remove** and **Modify** buttons) and the right-hand Trip Summary (service count, per-item lines, subtotal, taxes & fees, total payable, **Continue Shopping** → `/activities`,
**Proceed to pay** → step 2). The header cart icon shows the item count badge and opens `/checkout`.
- A user has at most ONE open checkout (the cart) holding 1..5 items. The "session" in this doc IS that cart: `Session.items: CartItem[]` (each = former single-item payload: activity, option, date, adults, children, per-item pricing, pickup, additional) and `pricing` is the cart total. `Session.steps` = `{ cart: boolean, pickup: boolean, additional: boolean, customer: boolean }`.
- Endpoints (replace the single-item ones; keep names where possible):
  - `GET /checkout/cart` → current open Session or `{ items: [], ... }` empty shape (never 404). Header badge uses `items.length`.
  - `POST /checkout/cart/items` body `{ activitySlug, optionId, date, adults, children }` → adds an item (server-priced, capacity-held for `CHECKOUT_HOLD_MINUTES`; adding the same option+date merges or replaces, document which) and returns the Session. 409 `CART_FULL` above 5 items, `DATE_UNAVAILABLE`, `PAX_LIMIT`.
  - `PATCH /checkout/cart/items/:itemId` (Modify: same body fields, re-validates and re-prices) and `DELETE /checkout/cart/items/:itemId` (Remove, releases the hold).
  - `PATCH /checkout/cart/items/:itemId/pickup` and `.../additional` (per item; pickup only for options with `pickupRequired`; items without pick-up skip that step).
  - `PATCH /checkout/cart/customer`, `POST|DELETE /checkout/cart/promo`, `POST /checkout/cart/pay`, `GET /checkout/cart/status` (cart-level). `GET /checkout/sessions/:id` and `/status` also keep working by id for the post-payment redirect.
  - Pay creates ONE order: one Booking per item (each its own reference, all linked by `orderReference` `OR-` + 8 base32) and ONE PaymentIntent for the total; the webhook confirms every booking of the order and closes the cart. A booking never confirms without payment success (mock mode excepted).
  - Holds are per item with one shared expiry window that restarts when the cart changes; expiry removes expired items and tells the client (`Session.expired: CartItem[]` for one response, then dropped).
- `/checkout` (Review Cart) → `/checkout/pickup` → `/checkout/details` → `/checkout/customer` → `/checkout/payment` routes (or `/checkout/[step]`), each guarded: steps cannot be skipped, stepper shows completion ticks and allows going back. "Modify" opens `/activities/[slug]?modify=<itemId>` prefilled; saving updates the item and returns to `/checkout`.
- Confirmation: `/bookings/order/[orderReference]` shows all items; `/bookings/[reference]` shows one.

## Implementation notes

What was built and where the implementation chose, narrowed or extended the contract. The amendment's cart model is implemented; the single-item session endpoints it supersedes were NOT built (`POST /checkout/sessions`, `PATCH /checkout/sessions/:id/pickup|additional|customer`, `POST|DELETE /checkout/sessions/:id/promo`, `POST /checkout/sessions/:id/pay`, `GET /checkout/sessions?status=open`). `GET /checkout/sessions/:id` and `GET /checkout/sessions/:id/status` exist for the post-payment redirect.

### Cart behaviour
- **Same option + date added twice REPLACES the item** (same `itemId`; traveller counts are set, not summed; pick-up and additional details are kept when the option is unchanged). Repeated "Proceed to pay" clicks are therefore idempotent. Modifying an item onto another item's option + date answers 409 `DUPLICATE_ITEM`.
- A user has at most one active cart (unique partial index). Removing the last item deletes the cart. Maximum 5 items (409 `CART_FULL`).
- One shared hold window per cart (`CHECKOUT_HOLD_MINUTES`). It restarts on add, modify and remove, and again at pay (to give the payment step a fresh window). Pick-up, additional, customer and promo changes do not extend it.
- Expiry: an expired open cart becomes `expired`; the next `GET /checkout/cart` returns an empty cart with `expired: CartItem[]` once, then nothing. `GET /checkout/cart/status` then reports `expired`.
- Editing a cart that is `awaiting_payment` (and unpaid) cancels its order, bookings and PaymentIntent and reopens it. If the payment already succeeded or is in flight the edit answers 409 (`CART_LOCKED` / `PAYMENT_IN_PROGRESS`).
- `steps`: `cart` = has items; `pickup` = every item that needs pick-up has one (`mode: "later"` counts); `additional` = every item had `PATCH .../additional` called (send `{}` to skip); `customer` = customer saved.
- Money in cart/session responses is AED; `?currency=XXX` on checkout routes adds an indicative `pricing.display` (the currency interceptor never touches `checkout`, `bookings` or `payments`). `POST .../quote?currency=XXX` does the same for the quote.

### Pricing and promo
- Server-side only, in integer minor units. `taxesAndFees` = `CHECKOUT_TAX_PERCENT` of the discounted amount, per item; `total = subtotal - discount + taxesAndFees`; cart totals are the exact sums of the items and equal the PaymentIntent amount.
- A promo discounts the (eligible) subtotal before tax and is split across items by largest remainder. `percent` is 1-100 with optional `maxDiscount`; `fixed` is an AED amount capped at the subtotal; `minSubtotal` and `appliesTo` (activity slugs) apply. Invalid, expired, exhausted or inapplicable codes all answer the same generic 400 `INVALID_PROMO`.
- `usedCount` is incremented once per paid order (on confirmation), not when a code is applied, so uses are not reserved by open carts; `usageLimit` is checked when applying and may be exceeded slightly by concurrent payments. If a promo stops being valid before payment, pay answers 409 `PROMO_NO_LONGER_VALID`. An order total of zero is refused (400 `INVALID_TOTAL`).

### Availability
- Counts adults + children. Counted: confirmed bookings, `pending_payment` bookings with an unexpired hold, and unexpired open carts. A cart's own holds are ignored when that cart adds, modifies or pays.
- `past` is returned for days before today (Asia/Dubai) and for days whose booking deadline (start time minus `cutoffHours`) has passed. Without a clean `HH:mm` start time the deadline reference is the end of the service day. `thisWeekend` is the first available Friday, Saturday or Sunday within the next 7 days; `nextAvailable` and `thisWeekend` are computed within the requested month only.
- Quote and cart failures: 400 `INVALID_DATE`, `DATE_TOO_FAR` (more than 365 days), `PAX_LIMIT`, `CHILD_NOT_ALLOWED`; 409 `DATE_UNAVAILABLE` (past, blackout, non-operating day, sold out or not enough capacity); 404 `OPTION_NOT_FOUND`. Error bodies are `{ statusCode, code, message }`.
- Capacity checks and holds are not atomic across concurrent requests (no per-day counter document); `pay` re-validates every item, which narrows but does not remove the window for a last-seat race.

### Payments and orders
- `pay` is idempotent: it returns the same order, bookings and PaymentIntent (same idempotency key `order:<orderReference>`); after a completed payment a repeat within 15 minutes replays `{ mode, status: "succeeded", ... }`. Extra response fields besides the contract: `orderReference`, `bookingReferences`, `sessionId`.
- The webhook (`payment_intent.succeeded` with `metadata.orderReference`) only confirms an order whose `amount_received` equals the order total; an order that already expired or was cancelled is NOT confirmed (logged for manual refund). On expiry of an `awaiting_payment` cart the PaymentIntent is cancelled first so a late payment cannot succeed; if cancelling fails (payment in flight) the cart is left alone. `payment_intent.payment_failed` is not handled: the hold simply runs until it expires, so the customer can retry with the same PaymentIntent.
- `publishableKeyConfigured` is true when `STRIPE_PUBLISHABLE_KEY` is set in the API environment (only the boolean is exposed).
- Stripe-mode payment was not exercised end to end (no Stripe keys here); mock mode was. Orders live in `orders`, carts in `checkout_carts`, promo codes in `promo_codes`, reviews in `activity_reviews`.

### Bookings
- Activity bookings have no `sku`; `serviceType` is `activity`. New fields: `orderReference`, `cartItemId`, `activitySlug`, `activityImage`, `activityLocation`, `optionId`, `optionName`, `transferType`, `startTime`, `serviceDay` (YYYY-MM-DD), `adults`, `children`, `pickupRequired`, `pickup`, `additional`, `customer`, `priceLines`, `discount`, `promoCode`, `holdExpiresAt`; `subtotal`, `tax`, `total`, `refundable` and `freeCancellationUntil` are reused.
- `GET /bookings/:id` accepts a Mongo id or the booking reference. Added `GET /bookings/order/:orderReference` (all bookings of an order, for `/bookings/order/[orderReference]`): `{ orderReference, status, total, currency, bookings[] }`. Cancellation responses now include `message` stating that refunds are handled by staff.
- The sku-based `POST /bookings` and `POST /payments/intents` flow is unchanged.

### Details, reviews, admin
- Sample details (`detailsAreSample: true`) are stripped in production (so their options are not bookable) unless `ACTIVITY_SAMPLE_DETAILS=true`; the `detailsAreSample` flag itself is only returned outside production. The activity list never includes detail fields. Sample promo codes follow the same switch.
- `PATCH /catalog/activities/:id/details` replaces `gallery` and `options` wholesale and marks the details as real (`detailsAreSample: false`) unless the body says otherwise; `published` and the legacy fields cannot be edited there.
- Reviews: breakdown counts use the bands on the 1-5 rating (5 excellent, 4 veryGood, 3 average, 2 poor, 1 terrible); `average` has one decimal. `images` stays empty because there is no upload flow (the `withImages` filter works for images added by staff later). "Service date has passed" means the service day is before today in Asia/Dubai. Review moderation and the extra `GET /catalog/reviews/admin` queue allow `admin`, `super_admin`, `support`, `content` (super_admin added to the contract's list, as elsewhere in the codebase). Posting a review is throttled to 10 per minute; applying a promo and paying to 10 per minute.
- Extra env keys: `STRIPE_PUBLISHABLE_KEY`, `CHECKOUT_SWEEP_SECONDS`.
