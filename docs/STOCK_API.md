# Stock and availability (Phase 1): design and API contract

This is the shared contract between the API (`Tourvex-API`) and the admin and public site (`Tourvex-NextJS`). If you must deviate, change this file in the same change and tell the others.

## Decisions (agreed with the business owner)
- **Stock model: per date, per ticket type.** Example: "Burj Khalifa - Adult" has 200 tickets for each day. It sells out for that date only. Unlimited when no capacity is set.
- **Hold at checkout, deduct on payment.** Capacity is held while a customer pays (the existing `pending_payment` booking hold, `holdExpiresAt`, default 10 minutes, released automatically on expiry/failure) and is permanently used once the order is paid (`confirmed`). Never oversell: the existing transactional checkout (`CapacityLock` + `TransactionService`, see `src/checkout/checkout.service.ts` `ensureOrder`) already re-checks capacity inside the order transaction; keep that guarantee for every product type.
- **At zero stock: sold out for that date; the product is hidden from public listings when no date is bookable any more.** The product page itself still opens and shows "Sold out". Low stock shows "Only X left!".
- **Cancellation / refund:** units return to stock automatically when the booking is cancelled or fully refunded **before the cutoff** (cutoff = the option's `cutoffHours` or 24h when unset); after the cutoff the units stay used unless staff press "Return to stock". Every change is written to the ledger.
- **Products:** activities (options x dates), holidays (departures), cruises (cabin types x sailing dates), events (ticket types x sessions), plus manually created items for yachts, transfers, hotel rooms and add-ons (type `custom`; no product pages yet, so they only appear in the admin stock screens and ledger).
- **Enquiry-based products** (holidays, cruises, events have no pay-now checkout): staff press "Confirm booking" on the enquiry in the admin; that creates a confirmed booking, reduces stock inside a transaction and issues the invoice. (Online checkout for them comes later and must reuse the same stock engine.)
- **Alerts:** admin dashboard badge + Low stock / Sold out lists, an email to operations (once per event, never spammy), and an "Only X left" message on the website.
- Phase 2 (NOT in this phase): multi-country tax invoices (UAE VAT, India GST, Saudi/UK/EU VAT, configurable table), supplier purchase invoices, margin reports, PDF emailing.

## Vocabulary
- `productType`: `activity | holiday | cruise | event | yacht | transfer | hotel | custom`
- Stock **item** = one sellable unit type: `{ productType, productRef, variantId }`.
  - activity: `productRef` = activity slug, `variantId` = option id.
  - holiday: `productRef` = holiday slug, `variantId` = `default` (stock is per departure date).
  - cruise: `productRef` = cruise slug, `variantId` = cabin type name (as stored, e.g. `Balcony`).
  - event: `productRef` = event slug, `variantId` = ticket type name.
  - manual items: `productRef` = a slug the admin chooses, `variantId` = `default` or any short id.
- Item **id** (used in URLs): `"{productType}:{productRef}:{variantId}"`, URL-encoded. Parse by splitting on the first two `:`.
- Dates are calendar days `YYYY-MM-DD` in the operating time zone (Asia/Dubai, see `catalog/activity-booking.utils.ts`).
- Effective capacity of an item on a date = the date override (`StockDay.capacity`) if present, else the item default (`StockPolicy.defaultCapacity`), else (activities only, legacy) the option's `dailyCapacity`, else **unlimited** (`null`). `closed` on a date (or `stopSale` on the item) means not bookable.
- `used` on a date = `sold` (confirmed bookings, plus cancelled/refunded bookings whose units were NOT returned) + `held` (unexpired `pending_payment` bookings and open cart holds). `available = capacity - sold - held` (never negative; `null` when unlimited).
- Row/day **status**: `unlimited | ok | low | sold_out | closed`. `low` = `available <= lowStockThreshold` (default 10) and `available > 0`.

## Data (Mongo; indexes and unique keys required)
- `stock_policies`: `{ productType, productRef, variantId, title, variantLabel, defaultCapacity: number|null, lowStockThreshold: number (default 10), stopSale: boolean, restockCutoffHours?: number|null, unitCost?: number|null (used in Phase 2), active, createdAt, updatedAt }`. Unique on `(productType, productRef, variantId)`. Created lazily on first edit; every catalog option/variant also appears in the admin list as a virtual item (unlimited) even without a policy document.
- `stock_days`: `{ productType, productRef, variantId, date, capacity: number|null, closed: boolean, note }`. Unique on `(productType, productRef, variantId, date)`; TTL or cleanup for dates older than 120 days is optional.
- `stock_movements` (ledger, append-only): `{ at, actorId, actorEmail, productType, productRef, variantId, title, type, date|null, before, after, delta, reason, bookingReference?, meta? }`, `type` in `set_default | set_day | adjust_add | adjust_remove | close | open | stop_sale | resume_sale | restock_auto | restock_manual | booking_confirmed | booking_cancelled | alert_low | alert_sold_out | create_item`.
- Booking gets generic stock fields (`stockProductType`, `stockProductRef`, `stockVariantId`; activity bookings keep using `activitySlug`/`optionId`) and `stockReleased: boolean`.
- Activity gets a denormalised `stockStatus: { soldOut: boolean, lowStock: boolean, nextAvailableDate: string|null, lowestRemaining: number|null, checkedAt: Date }` so public lists can filter cheaply. Holidays/cruises/events get the same field. It is refreshed after anything that changes stock (booking confirmed, hold expired, cancellation/restock, admin stock edits) and by a periodic sweep (dates roll over), then the public cache namespaces are invalidated (`CacheService.invalidate`).

## Admin API (`/api/v1/admin/stock`, bearer auth, new permissions `stock.read`, `stock.write`)
Permission mapping: super_admin and admin: both; operations: both; content: read; sales/support/finance: read. Follow `src/admin/permissions.ts`. Add a sidebar group in `src/admin/menu.ts`: **Inventory** (`/admin/inventory`) with children **Stock** (`/admin/inventory`), **Low stock & sold out** (`/admin/inventory/alerts`), **Movements** (`/admin/inventory/movements`), gated by `stock.read`. Write audit-log entries for every mutation (see `src/common/catalog/admin-catalog.ts` for the pattern) in addition to ledger rows.

1. `GET /summary` -> `{ lowStock: number, soldOut: number, stopped: number, attention: Item[] (max 8, worst first), generatedAt }`. Counts are over the next 30 days.
2. `GET /items?type=&q=&status=&page=&limit=&sort=` -> `{ items: Item[], pagination: {page,limit,total,pages} }`, status in `low|sold_out|closed|ok|unlimited`, sort in `attention|title|type|available`. `Item` = `{ id, productType, productRef, variantId, title, variantLabel, defaultCapacity: number|null, lowStockThreshold, stopSale, windowFrom, windowTo, capacityTotal: number|null, soldTotal, heldTotal, availableTotal: number|null, lowestRemaining: number|null, nextSoldOutDate: string|null, status, hasPolicy: boolean, updatedAt }`. Window = today .. today+29 days. Virtual (catalog) items are included.
3. `GET /items/:id?from=&to=` (max 93 days, default the current month) -> `{ item: Item, days: Day[] }`, `Day` = `{ date, capacity: number|null, capacitySource: 'override'|'default'|'legacy'|'unlimited', sold, held, available: number|null, closed, status: 'unlimited'|'ok'|'low'|'sold_out'|'closed'|'non_operational'|'past', note }`. `non_operational` = the activity option does not operate that weekday/blackout (read-only information).
4. `PATCH /items/:id` body `{ defaultCapacity?: number|null, lowStockThreshold?: number, stopSale?: boolean, unitCost?: number|null, reason?: string }` -> `Item`. Lowering `defaultCapacity` below already committed units on any future date without an override is allowed only if overrides cover those dates; otherwise 409 `STOCK_BELOW_COMMITTED` with the first offending date.
5. `PUT /items/:id/days` body `{ from, to, weekdays?: number[0-6], mode: 'set'|'add'|'remove'|'clear', capacity?: number>=0, closed?: boolean, note?: string, reason?: string }` -> `{ updated: number, days: Day[] }`. `set` writes absolute capacity overrides, `add`/`remove` change the effective capacity by `capacity` units (reason required), `clear` deletes overrides. Never below `sold + held` for that date (409 `STOCK_BELOW_COMMITTED`, report the date and committed units). Max range 93 days. Writes ledger rows (one per date changed, or one summarised row for ranges over 31 days).
6. `POST /items` create a manual item `{ productType: 'yacht'|'transfer'|'hotel'|'custom', productRef, variantId?, title, variantLabel?, defaultCapacity: number|null, lowStockThreshold? }` -> `Item` (409 if it exists).
7. `GET /movements?itemId=&type=&actor=&from=&to=&page=&limit=` -> `{ items: Movement[], pagination }` newest first.
8. `POST /bookings/:bookingId/return-to-stock` body `{ reason }` -> `{ returned: number, booking }` for a cancelled/refunded booking whose units were kept (409 `ALREADY_RETURNED` / `NOT_RETURNABLE`).
9. `POST /enquiry-bookings` (enquiry confirm) body `{ source: 'holiday'|'cruise'|'event', enquiryId, variantId, serviceDay, quantity, adults?, children?, totalAmount, currency, paymentMode: 'cash'|'bank_transfer'|'card_offline'|'other', paymentReference?, note? }` -> `{ booking, invoiceNumber|null }`. In ONE transaction: take the stock lock, re-check availability (409 `STOCK_UNAVAILABLE` with `available`), create a confirmed booking (customer details from the enquiry), mark the enquiry `booked` with `bookingReference`. Invoice/voucher are created after commit by the existing confirmation path (idempotent). Permission `stock.write` plus the enquiry status permission.

All list endpoints are `Cache-Control: no-store`.

## Public API additions (no breaking changes)
- `GET /catalog/activities`: sold-out activities (`stockStatus.soldOut`) are excluded; each item gains `stock: { lowStock: boolean, remaining: number|null }` where `remaining` is the lowest remaining count over the next 14 days when low, else null.
- `GET /catalog/activities/:slug`: gains `stock: { soldOut: boolean, lowStock: boolean, nextAvailableDate: string|null }`. Sold-out activities still resolve (not 404).
- `GET /catalog/activities/:slug/availability`: each day gains `remaining?: number` when the day is bookable and `remaining <= lowStockThreshold` (so the date picker can show "Only 3 left").
- Holidays/cruises/events: lists exclude `stockStatus.soldOut`; detail gains `stock: { soldOut, lowStock, nextAvailableDate }`.
- Admin lists (`.../admin/all`) are never filtered by stock.

## Alerts
When an item's status crosses into `low` or `sold_out` for any date within the next 30 days, write an `alert_low` / `alert_sold_out` ledger row and email the operations recipients **once per (item, date, state) until it recovers**. Recipients: env `STOCK_ALERT_EMAILS` (comma separated) falling back to settings `supportEmail`; skip silently when none. Use the existing `NotificationsService`. Never block a booking on an email failure.

## Non-negotiables
- No overselling under concurrency (transaction + capacity lock; add a real-database concurrency test like `src/common/database/transaction.integration.spec.ts`).
- Every number shown must come from the same derivation (`StockService`), including public availability and admin screens.
- Cache: the Redis `catalog`/`holidays`/`cruises`/`events` namespaces must be invalidated when `stockStatus` changes.
- Idempotent hooks: repeated webhook/sweep runs must not double-count or double-alert.

## Implementation notes (backend, as built)

### Additions and clarifications to the contract (no breaking changes)
- **Item** also carries `unitCost: number|null`. `status` rules: `closed` = stop-sale, or every operational day in the window closed; `sold_out` = every open day in the window sold out; `low` = at least one open day low or sold out (see `nextSoldOutDate`); `unlimited` = no finite capacity; else `ok`. `GET /items?status=closed` therefore includes stop-sale items. Summary: `lowStock` = items with status `low`, `soldOut` = items with status `sold_out`, `stopped` = items with `stopSale`; `attention` = sold out, then low (fewest left first), then stopped.
- **Item id** in payloads is the raw `type:ref:variant`; the API accepts it raw or URL-encoded (also double-encoded) in the path.
- **Day.closed** is the date override's flag; an item-level `stopSale` shows as `status: 'closed'` on every operational day.
- **Errors** (HTTP body root, always `{ statusCode, code, message, ... }`): `STOCK_BELOW_COMMITTED` (409) adds `date`, `committed`, `capacity`; `STOCK_UNAVAILABLE` (409) adds `available`; `ENQUIRY_ALREADY_BOOKED` (409) adds `bookingReference`; `DATE_UNAVAILABLE` (409, public cart/checkout) adds `itemId` (cart line) and `available` when known. Other codes: `ITEM_NOT_FOUND` 404, `ITEM_EXISTS` 409, `INVALID_ITEM_ID`, `PAST_DATE`, `NOTHING_TO_SET`, `CAPACITY_REQUIRED`, `REASON_REQUIRED`, `UNLIMITED_ITEM` (add/remove on an item without capacity), `RANGE_TOO_LARGE`, `INVALID_RANGE`, `INVALID_DATE`, `NO_MATCHING_DAYS` (400), `ALREADY_RETURNED` / `NOT_RETURNABLE` (409), `ENQUIRY_NOT_FOUND` 404, `PAX_MISMATCH` 400.
- **PUT days**: `mode: 'set'` may omit `capacity` when only `closed`/`note` change. `clear` removes capacity override, closed and note for the range (409 `STOCK_BELOW_COMMITTED` if the default would fall below committed units). Dates before today are rejected (`PAST_DATE`). Weekdays: 0 = Sunday .. 6 = Saturday. The response `days` is the whole `from..to` range.
- **Movements**: `from`/`to` are plain `YYYY-MM-DD` (Asia/Dubai), `to` inclusive of the whole day. Rows also carry `itemId`. `before`/`after` are available units on that date (null = unlimited); `booking_confirmed` has `delta = -quantity` (hold at checkout is not a ledger row, the ledger shows the deduction on payment).
- **POST /enquiry-bookings**: `enquiryId` may be the enquiry id OR the lead id (the admin leads view). Leads now expose `sourceId` (the enquiry id). Enquiry list views gain `bookingReference`; enquiry `status` can also be `booked` (set only by this endpoint; not accepted by the status PATCH). The linked CRM lead (if open) moves to `won`. Permissions: `stock.write` AND `enquiries.write` (so in practice admins, or a user holding both roles; operations alone cannot).
- **Booking detail** (`GET /admin/bookings/:id`, id or reference) gains `stock: { returnable, held, used, returned, state: 'held'|'used'|'returned'|'none', released }`. Bookings created from enquiries have `serviceType` `holiday|cruise|event`.
- **Admin dashboard** `GET /admin/summary` gains `stock: { lowStock, soldOut }`.
- **Public cart** (`GET /checkout/cart`, `/checkout/sessions/:id` and every cart edit response): each item gains `available: boolean` (false when the date is sold out/closed or the quantity no longer fits; always true once the cart is awaiting payment) and `remaining?: number` (units left, only when capacity is limited). 409 `DATE_UNAVAILABLE` from add-item, modify-item and `/checkout/pay` carries `itemId` and, when capacity is limited, `available`.
- **Public activities availability**: `remaining` appears on available days with `remaining <= lowStockThreshold`.
- **Menu**: group `inventory` (icon key `inventory`, a new key for the UI icon map) with children `inventory-stock`, `inventory-alerts`, `inventory-movements`.

### Behaviour
- One derivation: `src/stock/stock.service.ts` (+ pure rules in `stock.rules.ts`). Sold = confirmed + cancellation_requested + cancelled/refunded with `stockReleased === false`; held = unexpired `pending_payment` + open carts. Legacy cancelled/refunded bookings (no `stockReleased`) stay free, as before.
- Capacity: date override > policy default > legacy `option.dailyCapacity` > unlimited. Locks: `capacity_locks` keys are `slug|option|day` for activities (unchanged) and `type|ref|variant|day` for everything else; the order transaction (`ensureOrder`), the enquiry confirmation and the admin edits all take them.
- Restock cutoff: policy `restockCutoffHours`, else the option's `cutoffHours` (an activity option stores 0 by default, which counts as set), else 24 h, before the service start (start time for activities, start of the Dubai day otherwise). The decision is stored on the booking (`stockReleased`) in the same update that cancels it / fully refunds it.
- `stockStatus` covers a 120-day horizon: `soldOut` = every variant that runs has no bookable date; `lowStock`/`lowestRemaining` look 14 days ahead. Refreshed after: payment confirmed, order released/expired, admin cancel/refund/restock/date change, admin stock edits, and by a sweep every 5 minutes (also 20 s after boot). Disabled when `NODE_ENV=test`. Cache namespaces `catalog|holidays|cruises|events` are invalidated only when a product's flags actually changed. Catalog edits (new option, new departure) are picked up by the next sweep.
- Alerts: unique record per (item, date, state) in `stock_alert_states`; created once, removed on recovery or when the date passes. One digest e-mail per refresh pass through `NotificationsService.stockAlert` (provider method `sendStockAlert`; the default provider only logs, wire a real one in the notifications module). Recipients: `STOCK_ALERT_EMAILS`, else settings `supportEmail`.
- New collections: `stock_policies`, `stock_days`, `stock_movements`, `stock_alert_states`; new indexes on `bookings` (stock identity, `serviceDay+status`). `npm run indexes:verify` checks the unique ones.

### Known limitations
- `stock_days` is not TTL-cleaned (optional in the contract).
- Holiday "departures" have no catalog dates: stock applies to every calendar day (use date overrides/closing).
- Online checkout for holidays/cruises/events is still not built; the engine supports it (use `StockService.ensureLocks/lock/capacityInfo`).
