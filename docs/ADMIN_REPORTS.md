# Admin dashboard and reports

Builds on `ADMIN_PLATFORM.md`, `ADMIN_OPERATIONS.md` and `ADMIN_CRM.md`. Module `src/admin-reports` (rules in `reports-rules.ts`, unit tested). Everything is computed from the live collections (`bookings`, `refunds`, `leads`, `tickets`, `users`, `vouchers`) with MongoDB aggregations: no invented numbers, no scoring, no model-generated text. Money is **AED only**; days are **Asia/Dubai** calendar days (`$dateToString` with `timezone: 'Asia/Dubai'`).

## Endpoints (all `Cache-Control: no-store`, 401 without a token, 403 without the permissions)

| Route | Permissions |
|---|---|
| `GET /admin/dashboard` | dashboard.read (each section needs its own permission, below) |
| `GET /admin/reports/sales` + `/export.csv` | dashboard.read + finance.read (+ finance.export) |
| `GET /admin/reports/top-activities` + `/export.csv` | dashboard.read + finance.read (+ finance.export) |
| `GET /admin/reports/lead-funnel` + `/export.csv` | dashboard.read + enquiries.read (+ enquiries.export) |
| `GET /admin/reports/support` + `/export.csv` | dashboard.read + tickets.read (+ tickets.export) |
| `GET /admin/reports/cancellations` + `/export.csv` | dashboard.read + bookings.read + finance.read (+ finance.export) |
| `GET /admin/summary` | unchanged (dashboard.read) |

Query: `range=7d|30d|90d|ytd` (default 30d; last N Dubai days including today; `ytd` = 1 January to today) or `from`/`to` (YYYY-MM-DD or ISO instant, read as a Dubai day; at most 366 days; `from`/`to` win over `range`). Errors: 400 `INVALID_RANGE`, `RANGE_TOO_LARGE`. CSV exports use `streamCsv` (BOM, formula-injection-safe, 10,000 rows) and are audited as `report.export` (entity `report`).

**Previous period** = the window of the same number of days ending the day before `from`. `deltaPct` is `round((cur-prev)/prev*100, 1)`; when `prev` is 0 it is `null` and `state` is `new` (cur > 0) or `none`. Rates compare in percentage points (`deltaPts`).

## Dashboard sections and permissions

The API only computes and returns the sections the caller may see (the response lists them in `sections`); numbers a role cannot see are never in the payload.

| Section (`kpis.*`, ...) | Needs |
|---|---|
| `bookings`, `cancellationRequests`, `intelligence.bookingsToday`, `cancellationRate`, activity of bookings/cancellations | bookings.read |
| `revenue` (with `net`, `refunded`), `refunds`, `intelligence.revenue/netRevenue/refundTotal/averageBookingValue`, `breakdowns.serviceTypes/topActivities`, `notes.excludedNonAed` | finance.read |
| `leads`, `intelligence.leadConversion`, `breakdowns.leadPipeline`, lead activity | enquiries.read |
| `tickets {open, overdue, created}`, `intelligence.slaCompliance`, ticket activity | tickets.read |
| `customers` | customers.read |
| `vouchers` | vouchers.read |

Each KPI = `{value, previous, deltaPct, state, series[], goodWhen}`; `series` is one zero-filled value per Dubai day of `range.days`. `goodWhen: "down"` (tickets, cancellations, refunds) tells the UI to colour a rise red.

## Formulas

- **Bookings created**: bookings with `createdAt` in the period, status other than `expired` (lapsed unpaid holds are not bookings).
- **Confirmed revenue**: sum of `total` of AED bookings whose `confirmedAt` is in the period (dated by payment confirmation). Non-AED confirmed bookings are excluded and counted in `notes.excludedNonAed` (shown in the UI).
- **Refunds**: sum of `amount` of `succeeded` AED refunds by refund date. **Net revenue** = confirmed revenue - refunds (a refund can fall in a later period than its booking).
- **Average booking value** = confirmed revenue / confirmed AED bookings in the period.
- **Cancellation rate** = bookings created in the period that are now `cancelled` or `refunded` / bookings created in the period (cohort based).
- **Lead conversion** = leads created in the period whose current status is `won` / leads created in the period.
- **First-response SLA** (tickets created in the period): met = first public staff reply within `support.firstResponseHours` (settings, default 4 h) of creation; missed = replied late, or still unanswered while active and past the target. Tickets inside the target, or closed without a reply, are not counted. Compliance = met / (met + missed).
- **Open tickets** (snapshot, now) = status open or pending; **overdue** = active tickets past the first-response or resolution target. **Bookings today** compares with yesterday's full day.
- **New customers** = users with the `customer` role and no staff role created in the period. **Vouchers redeemed** = vouchers with `redeemedAt` in the period.
- **Lead pipeline** = leads created in the period grouped by current stage. **Top activities** = top 5 by confirmed revenue, grouped by `activitySlug` (title for bookings without one).
- **Recent activity** is not range-bound: the latest bookings, leads, tickets and cancellation requests; people appear as first name + last initial, no e-mail or phone.

## Insights and summary

`insights: [{id, severity: info|warn, text, href}]` come from `buildInsights` (pure, tested): revenue (or bookings if revenue is not visible) vs the previous period (`steady` within 2 %, `new` when the previous period was 0), pending cancellation requests, overdue tickets, a low first-response SLA (below 80 % with at least 5 tickets), overdue lead follow-ups, unowned open leads, and non-AED bookings excluded. `summary = {headline, attention[]}` is the headline insight plus every warning with its link. The UI shows it as plain text, deliberately not labelled AI.

## Dark badge on the dashboard

"Net revenue (period)" = confirmed revenue - refunds as above; the info button shows the formula in a popover. No health score.

## Performance

Dashboard queries run in parallel; each metric is ONE aggregation over previous + current windows grouped by Dubai day (no per-day queries, no N+1). Results are cached 60 s in memory, keyed by window + the sorted set of section permissions (never by user), 200 entries max. Indexes: `bookings.createdAt`, `bookings.confirmedAt`, `refunds.createdAt`, `tickets.createdAt` already existed; added `leads {createdAt:-1}` and `users {createdAt:-1}`; vouchers use `redeemedAt`.

## Tests

- Jest: `src/admin-reports/reports-rules.spec.ts` (range resolution, Dubai bucketing around midnight, zero-fill, previous-period maths, percentage edge cases, insight rules, cache).
- Playwright: `tests/playwright/reports.spec.ts` (401/403, validation, exact numbers on a seeded 2020 window incl. Dubai day boundary and previous period, sales role gets only its sections, CSV + audit). Run the API under test with `NODE_ENV=test CLERK_AUTHORIZED_PARTIES=*` and the same database; the test seeds and deletes its own rows (marker `RPT-`) and Clerk users.

## Frontend

`/admin` (command center: pastel KPI board with count-up and pointer spotlight, Executive intelligence panel, bento tiles) and `/admin/reports` (+ one page per report with chart, table, range and CSV export). The range control is synced to the URL (`?range=7d|90d|ytd` or `?from=&to=`). Kit additions: `KpiCard`, `DeltaPill`, `CountUp`, `RangePicker`, `useSpotlight`, `AreaChart` (monotone cubic, hover tooltip), `HBars`, smooth gradient `Sparkline`; styles in `app/admin/_kit/dash.css` (own `--dsh-tint-*` tokens, own class names).
