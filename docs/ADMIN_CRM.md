# Admin CRM: leads, support tickets, customers, B2B partners

Builds on `docs/ADMIN_PLATFORM.md` (permissions, audit, list/CSV/notes conventions). All admin routes are under `/api/v1/admin/...`, need a Clerk bearer token, carry `@RequirePermission` and (for mutations) `@Audited`. Lists return `{items, pagination}`; errors `{statusCode, code, message}`.

## 1. Leads (`enquiries.*`)

Collection `leads`: one lead per `(source, sourceRef)` (unique index, so capture is idempotent). Fields: `reference` (LD-000123, atomic counter `crm_counters`), `source` (activity|holiday|visa|cruise|event|contact|b2b), `sourceRef` (the enquiry reference, e.g. `HOL-123456`, or `CON-XXXXXXXX`/`ACT-XXXXXXXX` for the contact form and activity enquiries), `catalog {type, slug, id, title}`, name, email, phone, nationality, subject, message, pax/adults/children, travelDate, `valueAed`, `status` (new|contacted|qualified|quoted|won|lost), `lostReason`, `priority` (low|normal|high), `ownerId`, `nextFollowUpAt`, `lastContactedAt`, `closedAt`, `tags`, `notes` (common notes), `timeline` (created, status, assigned, follow_up, contact, priority, imported), `marketingOptOut`, `consentAt`, `userId`.

**Capture.** `visas|cruises|events|holidays` call `LeadsService.captureSafe(...)` after saving their enquiry, so their public endpoints are unchanged and a CRM failure never fails the enquiry (reference-only logging). New public endpoints: `POST /contact` (5/min/IP, consent required, honeypot field `website`, optional `activitySlug`) and `POST /catalog/activities/:slug/enquiries` (10/min/IP, published activities). The holiday enquiry DTO gained optional `nationality`, `adults`, `children`, `marketingOptOut`.

**Status rules** (`leads.rules.ts`): open stages move freely among themselves except back to `new`; `won` not straight from `new`; `lost` needs `lostReason` (price, no_response, competitor, changed_plans, not_qualified, duplicate, spam, other); closed leads can only be reopened to `contacted`; closed leads have no follow-up.

| Route | Permission | Notes |
|---|---|---|
| `GET /admin/leads` | enquiries.read | filters `source,status` (comma lists), `owner` (id, `me`, `unassigned`), `priority`, `followUp` (due, overdue, today, none), `tag`, `from`, `to`, `q`; sort createdAt, updatedAt, nextFollowUpAt, name, status, priority, valueAed |
| `GET /admin/leads/pipeline` | read | kanban columns `{status,count,valueAed,items[<=40]}` + `totals {open,new,overdue,dueToday,unassigned}` (status filter ignored) |
| `GET /admin/leads/stats`, `/owners` | read | owners = active staff holding `enquiries.write` |
| `GET /admin/leads/export.csv` | enquiries.export | same filters, 10,000 rows, audited |
| `GET /admin/leads/:id` | read | with notes, timeline (newest first), `related.sameEmail` |
| `PATCH :id` `{priority?,tags?,valueAed?}` | write | |
| `POST :id/assign` `{ownerId|null}` | write | owner must be assignable (400 `INVALID_OWNER`) |
| `POST :id/status` `{status,lostReason?,note?}` | write | 409 with the rule code |
| `POST :id/follow-up` `{at|null,note?}` | write | |
| `POST :id/notes` `{text}` | write | |
| `POST :id/contact` `{channel: email|phone|whatsapp,note?}` | write | logs the contact; `new` becomes `contacted`. No message is sent (no mail provider). |
| `POST bulk/assign`, `bulk/status` | write | max 100 ids; bulk status reports `skipped[{id,code}]` per lead |

**Backfill.** `npm run leads:backfill [-- --dry-run] [-- --legacy-json ../Tourvex-NextJS/app/data/leads.json]` imports visa/cruise/event/holiday enquiries (legacy `closed` becomes `lost/other`, `contacted` stays) and the old Next.js file store; idempotent, prints counts only.

## 2. Support tickets (`tickets.*`)

Collection `tickets` (`TKT-000001` via the atomic counter). Categories booking|payment|refund|voucher|general|complaint; priority low|normal|high|urgent (complaints start `high`); status open|pending (waiting on customer)|resolved|closed; `messages[{id, authorType, authorId, authorName, body<=5000, internal, at}]`; `firstResponseAt` (first public staff reply), `resolvedAt`, `closedAt`. No attachments.

**SLA.** Targets come from the new settings group `support` (`firstResponseHours` default 4, `resolutionHours` default 48; `GET/PUT /admin/settings/support`). The clock runs from creation and does not pause while waiting on the customer. Computed per ticket (`sla`: firstResponse/resolution = met|met_late|pending|breached|n/a, `breached`, `dueSoon`, `nextDeadlineAt`).

**Customer API** (any signed-in user, strict ownership, others get 404): `POST /tickets` (5/min; optional `bookingId` of your own booking; max 20 active tickets), `GET /tickets`, `GET /tickets/:id` (internal notes hidden, staff shown as "Support team"), `POST /tickets/:id/messages` (pending/resolved become open; closed is 409), `POST /tickets/:id/close`, `POST /tickets/:id/reopen` (resolved anytime, closed within 14 days).

**Staff API:** `GET /admin/tickets` (`tab` mine|unassigned|all|overdue, `status`, `priority`, `category`, `assignee`, `from`, `to`, `q` by number/subject/requester/booking), `/counts`, `/assignees`, `/export.csv` (tickets.export), `GET :id`, `POST :id/reply {body, internal?, setStatus?}` (a first public reply self-assigns and sets `firstResponseAt`), `PATCH :id {priority?,category?}`, `POST :id/assign`, `POST :id/status`, `POST bulk/close` (tickets.write). Notifications are a stub: `NotificationsService.ticketEvent` logs the ticket number and event only.

## 3. Customers (`customers.*`) and partners (`partners.*`)

Customers are users without a staff role. New user fields: `tags`, `marketingOptOut`, `internalNotes`, `partnerProfile {discountPercent, creditTermsDays, creditLimitAed}`.

- `GET /admin/customers` (`q,status,b2b,marketingOptOut,tag,from,to`), `export.csv`, `GET :id` (profile, stats, last 10 bookings, tickets, leads, notes), `PATCH :id {tags?,marketingOptOut?}`, `POST :id/notes` (customers.write), `POST :id/deactivate|reactivate` (customers.delete, sets `active:false`, audited, cannot target yourself).
- **Lifetime value** = sum of `confirmed` bookings charged in AED. Confirmed bookings in another currency are counted in `otherCurrencyConfirmed` and not converted.
- `GET /admin/partners` (`status` pending|approved|rejected, `q`), `/counts`, `export.csv`, `GET :id`; `POST :id/review {decision: approve|reject, reason (required to reject), role (b2b_owner|b2b_manager|b2b_agent), discountPercent, creditTermsDays, creditLimitAed}` (atomic against the pending state, exactly one b2b role is set); `PATCH :id` edits role/terms of an approved partner (partners.write). The existing `PATCH /users/:id/partner-application` keeps working.

## Implementation notes and deviations

- The discount % and credit terms are stored but **not yet applied**: `bookings.service` still hard-codes the 10% partner discount.
- The legacy per-module enquiry admin routes (`/visas/enquiries/admin`, ...) are untouched and their `new|contacted|closed` status is not synced with the lead status; the lead is the source of truth.
- `GET /admin/summary` now reads `enquiries.open` from open leads and `tickets.open` from open+pending tickets.
- Support has `enquiries.read` and `customers.read` only (per the permissions map), so it can read leads and customers but not edit them or own leads.
- Public route throttles count invalid requests too (the throttler runs before validation).
- Playwright tests (`tests/playwright/crm.spec.ts`) need a server started with `NODE_ENV=test CLERK_AUTHORIZED_PARTIES=*` (real Clerk dev tokens); they pause ~1 minute three times to respect the 120/min and 5/min throttles, and delete everything they create.
