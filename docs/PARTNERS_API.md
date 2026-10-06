# Partners API contract

Source of truth for the "In Partnership with World-Class Attractions" strip (home page and activities page).
The NestJS API implements it; the Next.js site consumes it. Base URL `/api/v1`.

## Content rules (important)

- A partnership claim is a real-world statement. Sample data therefore uses only clearly FICTIONAL attraction names,
  no real brands, logos or trademarks, and never implies a real partnership. Samples have `logo: null` and
  `isSample: true`; the site renders a text wordmark when `logo` is null.
- Real partners are loaded through the admin endpoints or `npm run seed:partners -- --file partners.json`. Their logos
  are supplied by the business, which must have the right to show them.
- In production the section stays hidden (`items: []`) until real partners exist, unless `PARTNERS_ALLOW_SAMPLES=true`.

## Public

`GET /partners` (`@Public()`, `Cache-Control: public, max-age=300`)

Query: `placement` optional (`home` | `activities`; only partners enabled for that placement), `limit` default 24, max 48.

```ts
type Partner = { id: string; name: string; logo: string | null; category: string; href: string | null };
type Response = { title: "In Partnership with World-Class Attractions"; subtitle: string; items: Partner[] };
```

Only `published` partners. `isSample` partners are hidden when `NODE_ENV=production` unless `PARTNERS_ALLOW_SAMPLES=true`.
Order: `order` ascending, then `name`. No visible partners -> `items: []` (the site hides the section).
Invalid `placement` or `limit` -> 400.

## Admin (roles `content`, `admin`, `super_admin`; Bearer token)

- `GET /partners/admin/all` every partner (including unpublished and sample), full records, as `{ items: AdminPartner[] }`.
- `POST /partners` create. 201 with the full record. Duplicate name -> 409.
- `PATCH /partners/:id` partial update. 404 unknown id, 400 malformed id, 409 duplicate name.
- `DELETE /partners/:id` -> `{ id, deleted: true }`.

Anonymous -> 401. Unknown or non-whitelisted fields -> 400.

Body (create; all optional on PATCH):

| field | rule |
|---|---|
| name | string 2-80 chars, unique (case-insensitive) |
| logo | optional/nullable; must start with `/images/` or `https://` |
| href | optional/nullable; `https://` only |
| category | string 2-40 chars |
| placements | array subset of `['home','activities']`, default both |
| order | integer 0-999, default 0 |
| published | boolean, default true |

`AdminPartner`: `{ id, name, logo, href, category, placements, order, published, isSample, createdAt, updatedAt }`.

## Storage

Collection `partners`: `name` (unique), `logo`, `category`, `href`, `placements`, `order`, `published`, `isSample`, timestamps.
