# Admin operations: bookings, vouchers/QR, finance and invoices

Staff-side contract for the OPERATIONS domain. It builds on `ADMIN_PLATFORM.md` (RBAC, audit, list/CSV/notes conventions) and `ACTIVITY_BOOKING_API.md` (the booking/order/cart model). Base URL `/api/v1`; every route below is `@RequirePermission`-guarded, never cached (`Cache-Control: no-store`), money is AED, and every mutation is `@Audited`. Errors are `{ statusCode, code, message }`.

## Permissions

| Role | Gets |
|---|---|
| operations | bookings.read/write/cancel/export, vouchers.* |
| finance | bookings.read/refund/export, finance.*, invoices.* |
| support, sales | bookings.read |
| admin, super_admin | everything |

`bookings.export` was added to operations and finance (it existed but no role held it). Cancelling WITH a refund needs `bookings.cancel` and `bookings.refund`; operations can cancel with `refund: "none"` and finance refunds afterwards.

## Bookings and orders (`/admin/bookings`)

| Method and path | Permission | Notes |
|---|---|---|
| `GET /admin/bookings` | bookings.read | `q` (reference, order, customer name/e-mail, title), `status` (comma list), `serviceType`, `activity` (slug), `paymentStatus` (unpaid, paid, partially_refunded, refunded), `createdFrom/To` (ISO), `serviceFrom/To` (YYYY-MM-DD), `sort` (createdAt, serviceDate, total, status, reference, confirmedAt), paging |
| `GET /admin/bookings/export.csv` | bookings.export | same filters, 10,000 rows max, audited |
| `GET /admin/bookings/summary` | bookings.read | counts per status, cancellation request count, activities that have bookings |
| `GET /admin/bookings/cancellation-requests` | bookings.read | oldest first, each with `policy {eligible, refundAmount, reason}` computed from `freeCancellationUntil` |
| `GET /admin/bookings/orders`, `/orders/:orderReference` | bookings.read | orders group the bookings of one `orderReference` (status `mixed` when they differ) |
| `GET /admin/bookings/:id` | bookings.read | id or `TVX-` reference. Returns booking, customer, price lines, `timeline`, `refunds`, `voucher` (with QR), `invoice`, `creditNotes`, `notes` and `actions` (what the caller may do right now) |
| `POST /:id/notes` | bookings.write | `{text<=2000}` |
| `POST /:id/confirm` | bookings.write | `{paymentReference}`: records an OFFLINE payment for a `pending_payment` booking whose hold has not expired; issues the invoice and voucher |
| `POST /:id/cancel` | bookings.cancel | `{reason, refund?: policy|full|none|custom (default policy), refundAmount?}` |
| `POST /:id/cancellation/approve` | bookings.cancel | `{refund?, refundAmount?, note?}` same as cancel, only from `cancellation_requested` |
| `POST /:id/cancellation/reject` | bookings.cancel | `{reason}`: back to `confirmed`, voucher untouched |
| `POST /:id/refund` | bookings.refund | `{amount, reason, idempotencyKey?}` |
| `POST /:id/resend-confirmation` | bookings.write | re-sends confirmation and voucher (notification stub logs references only) |
| `PATCH /:id/service-date` | bookings.write | `{date, reason}`: re-runs the customer flow's availability, pax and cut-off check; refuses past dates and used vouchers |

Allowed transitions (`src/bookings/booking-rules.ts`): confirm from `pending_payment`; cancel from `pending_payment|confirmed|cancellation_requested`; approve/reject from `cancellation_requested`; refund from `confirmed|cancellation_requested|cancelled` with a recorded payment and something left; resend and edit date from `confirmed`. Anything else is 409 `INVALID_STATUS`.

### Refunds

- Ledger collection `refunds` (one row per attempt: amount, reason, mode `stripe|mock|manual`, status, provider id, credit note number, actor).
- Cap: refunded total can never exceed the booking total. The amount is RESERVED with one atomic conditional update (`refundedAmount + amount <= total`), so concurrent requests cannot over-refund (tested with three parallel calls: one 200, two 409).
- Stripe payments (`pi_...`) are refunded through `PaymentsService.refundPayment` with a deterministic Stripe idempotency key; `pi_mock_` payments are simulated; any other reference (offline payment) is recorded as `manual`. A provider error releases the reservation and answers 502 `REFUND_FAILED`.
- A repeated `idempotencyKey` returns the original row (`replayed: true`) without refunding again.
- A fully refunded booking becomes `refunded`, its voucher is voided and its invoice is marked refunded. A partial refund leaves the status alone.
- Every refund creates a credit note (see below).

## Vouchers and scanner (`/admin/vouchers`, `/vouchers`)

- One voucher per confirmed booking (`vouchers`, unique `bookingId`), issued idempotently from the confirmation path (`BookingsService.confirmPayment`, which both mock checkout and the Stripe webhook use). `npm run backfill:vouchers` issues missing vouchers and invoices for older confirmed bookings.
- `code`: 16 base32 characters (80 bits from the OS CSPRNG), never sequential or derived from data. QR text = `<first FRONTEND_URL>/v/<code>`: nothing else is encoded. The API returns the QR as `{text, size, path}` (module grid as one SVG path); clients render it without `innerHTML`. No external QR service.
- Status `issued | redeemed | void`. Valid only on the service day (Asia/Dubai): earlier is `too_early`, later `expired`. Cancelling or fully refunding voids it.

| Method and path | Permission | Notes |
|---|---|---|
| `GET /admin/vouchers` | vouchers.read | `q`, `status`, `activity`, `serviceFrom/To`, `redeemedFrom/To`, `redeemedBy`, sort issuedAt/redeemedAt/status |
| `GET /admin/vouchers/export.csv` | vouchers.export | |
| `GET /admin/vouchers/:id` | vouchers.read | |
| `POST /admin/vouchers/validate` | vouchers.validate | `{code}` (code, grouped code or the QR URL). Read-only. 200 `{verdict, ok, voucher, booking{travellers, activityTitle, leadTraveller, pickup...}}`; verdicts `valid, already_redeemed, void, too_early, expired, booking_inactive`; 400 `INVALID_CODE`, 404 `VOUCHER_NOT_FOUND` |
| `POST /admin/vouchers/:id/redeem` | vouchers.validate | atomic: only an `issued` voucher flips. A second scan is 409 `ALREADY_REDEEMED` with "Already redeemed at <time>"; also `VOUCHER_VOID`, `TOO_EARLY`, `VOUCHER_EXPIRED`, `BOOKING_INACTIVE` |
| `POST /admin/vouchers/:id/void` | vouchers.write | `{reason}`; a redeemed voucher cannot be voided |
| `POST /admin/vouchers/:id/resend` | vouchers.write | |
| `GET /vouchers/:code` | public, 30/min | minimal: `{status, valid, activityTitle, optionName, serviceDay, startTime, adults, children, redeemedAt}`; unknown code 404 |
| `GET /bookings/:id/voucher` | owner | `{code, displayCode, url, qr, status}` for the customer page |

Frontend: `/admin/scan` (camera via `BarcodeDetector` when present, else `jsqr`, plus manual entry; big green/red/amber result screens with traveller count and activity; Redeem button; scan history kept in `sessionStorage` without names; clear offline state, no offline redemption by design so a ticket can never be used twice) and `/admin/vouchers`. The customer voucher page `/bookings/[reference]` shows the QR; `/v/[code]` shows the public validity page.

## Finance and invoices

| Method and path | Permission | Notes |
|---|---|---|
| `GET /admin/finance/overview?from&to` | finance.read | default last 30 days, max 366: `collected, refunded, net, paymentsCount, taxCollected, discounts, byDay, byServiceType, outstanding{count,amount}` |
| `GET /admin/finance/reconciliation?from&to` | finance.reconcile | per Dubai day: payments, refunds, net, orders paid, `variance` (bookings of paid orders minus orders paid; should be 0) |
| `GET /admin/finance/reconciliation/:date` | finance.reconcile | the payments and refunds behind a day |
| `GET /admin/finance/reconciliation/export.csv?view=daily|lines` | finance.reconcile + finance.export | audited |
| `GET /admin/invoices`, `/export.csv`, `/:id` | invoices.read / invoices.export | filters `q, kind (invoice|credit_note), status, from, to` |
| `GET /admin/invoices/:id/pdf` | invoices.read | server-side PDF (pdfkit) |
| `POST /admin/invoices` | invoices.write | `{bookingId}` creates the invoice of a paid booking if missing (idempotent) |
| `GET /bookings/:id/invoice.pdf` | owner | created on first request for bookings confirmed before invoices existed |

- Numbers: `INV-YYYY-000001` and `CN-YYYY-000001`, one atomic counter per type and year (`counters`, `findOneAndUpdate $inc` upsert), year in Asia/Dubai. Invoices created before this change keep their old `INV-YYYYMM-` numbers.
- One invoice per booking (unique partial index plus a lookup for legacy rows); a credit note per refund (unique `refundId`), tax split proportionally with the last refund taking the exact remainder.
- Company details are a snapshot taken at issue from Settings > General: `legalName` (falls back to `siteName`), `address`, `taxNumber` (TRN/VAT, 4-30 chars) plus support e-mail and phone. The settings UI has the two new fields.
- All sums use integer minor units (`finance-rules.ts`), days are Asia/Dubai (UTC+4).

## Other changes

- `GET /bookings`, `GET /bookings/:id` and `GET /bookings/order/:ref` are now scoped to the caller for EVERY role (staff use `/admin/bookings`). `POST /payments/intents` uses the same lookup.
- Legacy `PATCH /users/:id/roles` (super_admin) and `/status` (admin) now follow the staff rules (no self-change, only a super admin touches admin/super_admin, last active super admin protected) and are audited (`user.roles`, `user.status`).
- Menu (built by the API): Bookings (All bookings, Orders, Cancellation requests), Vouchers & Scanner (Vouchers, Scanner), Finance (Overview, Invoices, Reconciliation).

## Implementation notes and limits

- Stripe refunds and real card payments were NOT exercised (no Stripe keys here): mock and manual modes were. The Stripe path is a single `refunds.create` call with an idempotency key.
- Staff `confirm` records an offline payment; it does not mark the checkout `orders` row as paid and does not cancel a Stripe PaymentIntent, so only use it for payments made outside the site.
- Service date changes keep the price and the original `freeCancellationUntil`.
- Cancelling a confirmed legacy (sku) booking returns the stock to `available`; Stripe/mock refunds for legacy bookings follow the same rules.
- Staff names are shown as e-mail addresses (the auth user carries no display name).
- Reconciliation loads at most 50,000 rows per type and says so (`truncated`); it only totals AED and reports `excludedNonAed`.
- Invoice numbers consumed by test runs leave gaps in the sequence (counters are never decremented).
- Tests: Jest (`booking-rules`, `voucher-code`, `vouchers.service` redeem atomicity, `invoice-rules`, `invoice-pdf`, `finance-rules`) and `tests/playwright/operations.spec.ts` (authenticated flow with real Clerk dev tokens: needs the API under test to use `NODE_ENV=test`, `CLERK_AUTHORIZED_PARTIES=*` and the same database as `MONGODB_URI`/`.env`).
