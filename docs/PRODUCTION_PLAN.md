# Tourvex production development plan

## Scope authority

The client approval proposal dated **23 September 2026** is the controlling baseline. The following are approved additions to that baseline:

- customer and B2B authentication;
- multi-role authorization and customer, partner, operations and administration portals;
- the in-house **Tourvex CRM** for inventory, bookings, billing, partner pricing and refunds;
- Stripe payments;
- English and Arabic interfaces, RTL support and multi-currency presentation;
- migration of the current Karnish WordPress activity catalog;
- mocked flight, hotel, activity, visa and transfer suppliers until real sandbox credentials are supplied;
- local Docker development, DigitalOcean production delivery and Playwright automation.

## Product boundaries

1. The existing Next.js visual system remains authoritative: `#2095AE`, `#0f2454`, `#5e6282`, Barlow fonts, component spacing and current GSAP/Swiper/WOW motion behavior are preserved.
2. The browser never decides price, discount, availability, refund value or booking status. Those values come from the API.
3. Supplier integrations use a stable adapter contract. Replacing the mock adapter must not change frontend contracts.
4. English is the fallback language. Arabic content uses the same catalog records and the interface switches to RTL.
5. The base accounting currency is AED. Display currencies may include every ISO 4217 currency, but checkout is limited to currencies supported by the configured Stripe account and available exchange rates.

## Delivery phases

| Phase | Outcome | Acceptance gate |
| --- | --- | --- |
| 0. Foundation | NestJS, MongoDB replica set, Redis/storage/mail services, OpenAPI, security, CI | build, lint, unit and API smoke tests pass |
| 1. Catalog | 220 activities imported, filters/search/detail API, local website media stored in MongoDB GridFS, media ownership register | item counts, asset checksums and sampled fields match source |
| 2. Identity | customer/B2B registration, approval, roles and portal route protection | role matrix automated tests pass |
| 3. Commerce | server quotes, inventory holds, bookings, Stripe, invoices, cancellations/refunds | idempotent payment and stock tests pass |
| 4. Supplier verticals | mocked end-to-end flows, then one real adapter per vertical | contract tests pass for mock and sandbox |
| 5. Frontend integration | replace static data and inactive forms without visual redesign | screenshot comparison and Playwright journeys pass |
| 6. Production | DigitalOcean registry/deploy, managed MongoDB, backups, monitoring, runbooks | staging sign-off, restore drill and go-live checklist |

## Data ownership and governance

- Karnish/Tourvex owns customer, partner, booking, pricing-rule, invoice, refund, support and original catalog records created in Tourvex CRM.
- Migrated WordPress text and images are marked with their source URL. Migration does **not** prove copyright ownership; Karnish must supply an ownership/licence confirmation before production publication.
- The current website's owned local images are stored as checksummed MongoDB GridFS objects and served through the public media API. The repository copies are import sources only and are not used by the running frontend.
- Supplier offer content remains subject to each supplier contract. Tourvex stores normalized offers, references and audit evidence only for the permitted retention period.
- Stripe owns raw card data. Tourvex stores Stripe identifiers and payment state only; card numbers/CVC never enter this API.
- Each personal-data collection purpose needs a retention rule, export process and deletion/anonymization workflow before launch.
- Production access follows least privilege. Finance can manage invoices/refunds, operations can manage stock/bookings, content can manage catalog, and only super administrators can change role assignments.

## Production target

- DigitalOcean Container Registry for immutable API images.
- DigitalOcean Droplet or App Platform for containers behind TLS/reverse proxy.
- DigitalOcean Managed MongoDB and Managed Redis for production; local MongoDB runs as a replica set.
- MongoDB GridFS for website media, with database backups covering both metadata and binary chunks. A CDN may cache the public media endpoint without becoming the system of record.
- Provider decisions still required before launch: transactional email, SMS and WhatsApp Business account.
- Required production controls: encrypted backups, point-in-time recovery where available, secret manager, uptime/error monitoring, centralized logs, vulnerability scanning and quarterly restore tests.

## Definition of done

A feature is done only when API schema, authorization, validation, audit impact, automated tests, frontend states, Arabic/RTL behavior, failure handling and operational documentation are complete. Real supplier launch additionally requires sandbox contract tests and reconciliation against supplier reports.
