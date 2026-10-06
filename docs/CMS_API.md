# Website content management (CMS) contract

Goal: every piece of visible text/imagery on the public website is editable from the admin and served by the API. Phase A (this doc's first delivery):
the **Home page** (every section, desktop and mobile variants) and **global** content (header/nav labels, footer, search/labels shared across pages, SEO defaults,
contact details). Later phases add other pages (about, contact, holidays/visas/cruises/events/activities heroes and static copy, legal pages) by only adding schemas + seeds.
NestJS implements it, the admin (`app/admin/content`) and the public site (`Tourvex-NextJS`) consume it. Base URL `/api/v1`.

## Model
- A **content document** is addressed by `key` (e.g. `page.home`, `global.header`, `global.footer`, `global.seo`) + `locale` (only `en` now, field is stored and accepted so
  `ar` can be added later without migration; unknown locale = 400).
- Each document has a **schema** defined in code (single source of truth, `src/cms/schemas/*.ts`), a **published** payload and an optional **draft** payload, `version` (int, increments on publish),
  `publishedAt/By`, `draftUpdatedAt/By`, and **revisions** (last 50 published versions, each `{version, data, publishedAt, publishedBy, note}`).
- Page documents contain an ordered list of **sections**: `{ id, type, enabled, data }` where `type` names a section schema (e.g. `hero`, `categoryTiles`, `bestSellers`, `exploreByExperience`,
  `partners`, `why`, ...; the implementer derives the real list from the current home components) and `data` follows that section schema. Order = array order; admin can reorder and enable/disable
  sections whose schema has `canDisable: true`; some sections are `fixed: true` (cannot be removed) but still editable. Global documents are a flat `data` object (no sections).
- **Field schema format** (served to the admin so forms are generated, never hard-coded in the admin):
```ts
type Field =
 | { name; type:'text';      label; help?; required?; maxLength; placeholder? }
 | { name; type:'textarea';  label; help?; required?; maxLength; rows? }          // plain text, line breaks kept
 | { name; type:'richtext';  label; help?; required?; maxLength }                  // restricted markdown subset: **bold**, *italic*, links [t](url), line breaks, bullet lists; NO html
 | { name; type:'image';     label; help?; required?; aspect?: string; alt: true }  // value {url, alt} ; url is /images/..., /api/v1/media/images/..., or https
 | { name; type:'link';      label; required?; }                                    // value {label, href}; href relative (/...) or https (http blocked, javascript: blocked)
 | { name; type:'toggle';    label; }
 | { name; type:'number';    label; min; max; }
 | { name; type:'select';    label; options:[{value,label}] }
 | { name; type:'color';     label; }                                               // #rrggbb
 | { name; type:'list';      label; itemLabel; min?; max; fields: Field[] }         // repeater, items get stable ids
 | { name; type:'group';     label; fields: Field[] };                              // nested object
type SectionSchema = { type; label; description?; icon?; fixed?: boolean; canDisable?: boolean; fields: Field[] };
type DocumentSchema = { key; label; description?; kind:'page'|'global'; sections?: {allowed: string[]; default: string[]}; fields?: Field[]; previewPath?: string };
```
- Server-side validation from the schema on every draft save and publish (types, required, maxLength, link/URL rules, list min/max, unknown fields rejected, sanitised strings: strip control chars,
  no HTML ever stored/returned as HTML). Richtext is stored as the markdown subset and rendered by the site with a tiny safe renderer (no `dangerouslySetInnerHTML` of raw input).
- **Seeds = current site content.** The implementer extracts the EXACT text currently hard-coded in the site components (HomeSections.js, MobileHero.js, MobileTiles.js, navTabs.js, SiteHeader.js, MegaMenu.js, SiteFooter.js, SearchPage placeholder texts shared with home, PartnersStrip titles, BestSellerCards/ExperienceCards headings, season grid headings, 'Why book' band, CTAs, aria labels that are user-visible text, etc.) into the seeds, so after seeding the site looks identical. `npm run seed:cms` (idempotent; never overwrites an existing published/draft payload unless `--force` per key) and the site keeps the same defaults in `app/content/defaults/*.js` as a **fallback** when the API is unreachable (build these from the same seed JSON: one source file `Tourvex-API/content/defaults/<key>.json` copied/imported so they cannot drift; document the sync command).
- Dynamic data (activities, prices, cities, partners strip items, counts) is NOT content; it keeps coming from its existing endpoints. Section texts around them (titles, subtitles, button labels, 'from' labels, empty states) ARE content.

## Public endpoints (no auth)
- `GET /content/:key?locale=en` -> `{ key, locale, version, publishedAt, data | sections }` published payload only. 404 unknown key; keys are validated against the registry. `Cache-Control: public, max-age=30, stale-while-revalidate=300`, strong ETag.
- `GET /content?keys=page.home,global.header,global.footer,global.seo` -> `{ items: {key: payload} }` (one round trip for a page; max 10 keys).
- Preview: `GET /content/:key?preview=<token>` returns the DRAFT when the token (signed, 15 minutes, bound to key, issued by the admin endpoint below) is valid; response `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- If a document has never been published, the public endpoint returns the seed defaults (so the site never breaks).

## Admin endpoints (permissions `cms.read`, `cms.write`, `cms.publish`; all audited with `@Audited('content', action)` incl. field-level change summaries, never sensitive data; no-store)
Permission map additions: content, admin, super_admin get cms.read/write/publish (content cannot change `global.seo` robots/analytics-type fields if any; keep simple: same rights); sales/support/operations/finance get none.
- `GET /admin/content` -> list of documents `{key,label,kind,locale,status:'published'|'draft-changes'|'never-published',version,updatedAt,updatedBy}`.
- `GET /admin/content/:key` -> `{ schema: DocumentSchema, sectionSchemas: {type: SectionSchema}, draft|null, published, version, status, previewPath }` (draft is the working copy, falls back to published).
- `PUT /admin/content/:key/draft` body `{ data | sections }` (complete payload; optimistic concurrency via `If-Match`/`baseVersion` + `draftRevision` -> 409 `CONTENT_CONFLICT` with the latest draft) -> saved draft + validation errors list `{path, message}` (400 `VALIDATION_FAILED`).
- `POST /admin/content/:key/publish` body `{ note? }` -> validates the draft strictly, snapshots a revision, makes it the published payload, clears the draft, bumps version.
- `POST /admin/content/:key/discard` -> drop draft.
- `GET /admin/content/:key/revisions` -> `[{version,publishedAt,publishedBy,note}]`; `GET .../revisions/:version`; `POST .../revisions/:version/restore` (loads that revision into the DRAFT, never auto-publishes).
- `POST /admin/content/:key/preview-token` -> `{ token, url }` (url = `<FRONTEND_URL><previewPath>?cmsPreview=<token>`).
- Media library (permissions `cms.write`): `POST /admin/media` multipart (field `file`, one image, png/jpeg/webp/avif only, **no SVG**, max 5 MB, magic-byte sniffing, dimension limit 8000px, random filename, stored in GridFS via the existing media module so it is served by `GET /media/images/:filename`), returns `{ id, url, filename, width, height, size, contentType }`; `GET /admin/media?q=&page=&limit=` list; `DELETE /admin/media/:id` (blocked with 409 + list of documents that reference it). Reject on failure with clear codes; throttle uploads; audit.

## Site behaviour
- `lib/content.js` (server) fetches `GET /content?keys=...` with `next: { revalidate: 30 }` and **per-key fallback to defaults** on any error; exports typed-by-convention helpers: `getPageContent('home')`, `getGlobalContent()`; a small `t()`-like accessor with safe fallbacks; preview mode: when the request has `?cmsPreview=<token>` (or cookie set by it), fetch draft with the token, `noindex`, show a small 'Preview mode' pill. Client components receive content via props or a `ContentProvider` (no client-side fetch flicker; SSR-rendered text).
- Home renders sections in the CMS order, skipping disabled sections; section components read all strings from their `data`. `generateMetadata` for home reads `global.seo`/`page.home` meta fields.
- No text, label or placeholder visible to users may remain hard-coded in the home components or header/footer/nav after this phase (code identifiers, aria-labels that are purely technical, and format strings excepted). The implementer lists any leftover.
- Never render content as HTML; richtext through the safe renderer; links via next/link when relative.

## Admin UI (`/admin/content`)
List page (documents with status chips: Published / Unpublished changes / Never published, last edited by/at) -> editor `/admin/content/[key]`: left rail with the section list (drag-and-drop + keyboard reorder, enable switch, add section from allowed types where permitted, remove non-fixed), right panel with the generated form for the selected section (all field types above, repeaters with reorder/add/remove, image picker dialog with upload + library + alt text, link editor, character counters, inline validation messages from the API), top bar with status chip, **Save draft** (also autosaves drafts locally and warns on leave), **Preview** (opens the site with a preview token in a side-by-side responsive iframe panel desktop/mobile or new tab), **Publish** (confirm dialog with note and a changes summary), **Discard draft**, **History** drawer (revisions list, view, restore into draft). Permission aware. Uses the shadcn-based admin kit and respects light/dark + motion policy.
