# atc-render

PDF rendering from versioned JSON layout templates. A template has immutable numbered versions; each is a layout of headings, text with `{{path}}` placeholders and `**bold**` / `_italic_` runs, key/value lists, tables that break across pages with a repeated header, images (from atc-media or base64), QR codes, dividers, spacers and page breaks, with `if` on any block and a header/footer showing page numbers. A render returns the PDF as an attachment or stores it as a private atc-media file. HTTP only.

Runtime dependencies: `fastify`, `@fastify/rate-limit`, `@atc-web/atc-service-core` and **`pdfkit`**. Storage is SQLite via `node:sqlite` (Node 22.13+).

**Why pdfkit.** Writing PDF by hand means font subsetting, TrueType/CFF parsing, CMaps for searchable text and image embedding, which is a large, security-relevant amount of code. pdfkit is a pure-JavaScript, widely used PDF writer with no native code and no network or file access unless given paths (this service only ever passes it Buffers). Its dependencies (fontkit, linebreak, png-js, fflate, @noble/hashes, @noble/ciphers) are pure JS too; `npm audit --omit=dev` is clean.

**Why vendored fonts.** The built-in PDF fonts cannot encode Turkish (`ş ğ ı İ`) or most non-ASCII text. The DejaVu family (Sans regular, bold, oblique, bold oblique and Sans Mono, 3 MB) is in [`fonts/`](fonts) with its license ([`fonts/LICENSE-DejaVu.txt`](fonts/LICENSE-DejaVu.txt): Bitstream Vera license with public-domain changes, free to redistribute and embed). Fonts are read from disk, never fetched; every PDF embeds only the glyphs it uses and a Unicode map, so text stays selectable and searchable.

## Run

```bash
cp .env.example .env        # set RENDER_API_KEYS (and MEDIA_URL/MEDIA_API_KEY for media images and stored renders)
npm ci
npm run dev
```

Production with PM2:

```bash
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

Docker (the image contains `fonts/`):

```bash
docker build -t atc-render .
docker run -p 3015:3015 -v atc-render-data:/data --env-file .env atc-render
```

Tests and type check:

```bash
npm test
npm run typecheck
```

After changing `src/domain/layout-schema.js`, run `node scripts/openapi-layout.mjs` so `openapi.yaml` documents the schema that is enforced (a test fails otherwise).

## Model

- **Template**: a name (`[a-z][a-z0-9-]{0,63}`), a description and versions 1, 2, 3 … Publishing adds a version; versions never change. Renders use the latest unless a `version` is given. Versions beyond `MAX_VERSIONS` are pruned, oldest first.
- **Layout**: `page` (A4/Letter/A5, portrait/landscape, margins, base font size), optional `header`/`footer` (`{{page}}`, `{{pages}}`), and `blocks`. Validated against a closed JSON schema (`components.schemas.Layout` in [openapi.yaml](openapi.yaml)); a mismatch is `400 VALIDATION_FAILED` whose `details[].path` names the block.
- **Data**: any JSON object. `{{path}}` reads own properties by dot path; inside table columns the row is searched first, then the data. Markup is parsed before placeholders are filled, so data never adds formatting.
- **Render errors** found while drawing are `422` with `details.block` (`blocks[3].rows`).

## API

All `/v1/*` routes and `/metrics` need `Authorization: Bearer <secret>`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health`, `/ready`, `/v1/info` | none | Liveness, readiness, identity and capabilities |
| GET | `/metrics` | read | Prometheus text |
| GET / POST | `/v1/templates` | read / write | List; create with version 1 |
| GET / PATCH / DELETE | `/v1/templates/:name` | read / write / write | Template with its versions; description; delete with every version |
| POST | `/v1/templates/:name/versions` | write | Publish the next immutable version |
| GET | `/v1/templates/:name/versions/:version` | read | One version with its layout |
| POST | `/v1/render` | read | `{ template, version?, data, filename?, store? }` → `application/pdf` attachment, or `201 { fileId, url, expiresAt, pages, bytes, version }` with `store: true` |
| POST | `/v1/render/preview` | write | `{ layout, data }` → PDF of an unsaved layout |
| GET | `/v1/stats` | read | Templates; last 24 h renders, failures by code, average ms, pages, bytes, stored, per template |

PDF responses carry `content-disposition: attachment`, `content-security-policy: default-src 'none'; sandbox`, `x-render-pages` and `x-render-ms`. Errors are `{ "error": { "code", "message", "details"? } }`: `VALIDATION_FAILED`, `INVALID_LAYOUT`, `MEDIA_DISABLED` (400); `TEMPLATE_NOT_FOUND`, `VERSION_NOT_FOUND` (404); `TEMPLATE_EXISTS` (409); `DATA_TOO_LARGE`, `LAYOUT_TOO_LARGE` (413); `RENDER_FAILED`, `TOO_MANY_PAGES`, `TOO_MANY_IMAGES`, `IMAGE_TOO_LARGE`, `IMAGE_UNSUPPORTED`, `RENDER_TIMEOUT`, `PDF_TOO_LARGE` (422); `BUSY`, `RATE_LIMITED` (429); `MEDIA_ERROR` (502).

## Examples

Invoice, certificate, a report with a table across pages, and every feature: [examples/README.md](examples/README.md).

## Configuration

All configuration is environment variables; [.env.example](.env.example) documents each.

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3015`, `0.0.0.0` | Listen address |
| `RENDER_API_KEYS` | required | `id:secret[:role]`; role `read` (render), `write` (templates, preview), `readwrite` (default) |
| `ACTOR_KEYS` | empty | Key ids (the console) that may name the acting person in an `X-Actor` header; records show that name instead of the key id. Ignored for every other key |
| `MEDIA_URL`, `MEDIA_API_KEY` | empty | atc-media for image blocks by id and `store: true` (both or neither) |
| `MEDIA_TIMEOUT_MS`, `DOWNLOAD_TTL_SEC` | `10000`, `300` | Per media call; signed URL lifetime for stored renders |
| `MAX_PAGES`, `MAX_TABLE_ROWS` | `50`, `5000` | Per document, per table |
| `MAX_DATA_BYTES`, `MAX_LAYOUT_BYTES` | `262144`, `131072` | JSON size of data and of a layout |
| `MAX_IMAGES`, `MAX_IMAGE_BYTES`, `MAX_TOTAL_IMAGE_BYTES` | `20`, `2097152`, `10485760` | Image caps per document |
| `MAX_PDF_BYTES` | `20971520` | Output cap |
| `RENDER_TIMEOUT_MS`, `RENDER_CONCURRENCY` | `15000`, `4` | Per render; parallel renders (more answer 429) |
| `MAX_VERSIONS`, `RENDER_LOG_DAYS` | `100`, `30` | Versions kept per template; render log retention |
| `DB_PATH`, `DB_BACKUP_DIR`, `BODY_LIMIT`, `RATE_LIMIT_MAX` | `./data/render.db`, –, `4194304`, `600` | |
| `TRUST_PROXY`, `TLS_CERT_PATH`, `TLS_KEY_PATH`, `LOG_LEVEL` | | As in every service |
| `AUDIT_URL`, `AUDIT_API_KEY` | empty | Forward audit events (both or neither) |

## Security notes

- The only network peer is `MEDIA_URL`. Signed media URLs are fetched through it whatever host they name, without redirects, with byte caps. pdfkit is never given a path or URL.
- Images must be PNG or JPEG by magic bytes; counts and sizes are capped. Images behind a false `if` are not fetched.
- Placeholders read own properties only; data cannot inject formatting. No JavaScript, links or forms are written into PDFs.
- Layout and data sizes, pages, rows, render time and concurrency are bounded, so one request cannot monopolise the process.

## Code layout

```
src/
  index.js, application.js    entry point, composition root, lifecycle, render-log retention
  config.js, db.js, types.js   configuration, schema, typedefs
  domain/
    layout-schema.js          the closed JSON schema of layouts (also in openapi.yaml)
    template-text.js          placeholders, conditions, inline markup
    render-service.js         templates, versions, render/preview, limits, concurrency, stats
    errors.js                 RenderError codes and statuses
  pdf/
    renderer.js               pdfkit drawing: blocks, tables across pages, header/footer, fonts
    images.js                 image loading and caps
    qr-code.js                QR encoder (ISO/IEC 18004, no dependencies)
  net/media-client.js         atc-media: signed image bytes, stored renders
  store/                      TemplateStore, RenderLog
  http/                       RenderApi routes, ApiKeyAuth, Schemas, Views
fonts/                        DejaVu TTFs and their license
scripts/openapi-layout.mjs    copies the layout schema into openapi.yaml
test/                         node:test suites, with a PDF text extractor for content checks
```

## Out of scope by design

- HTML/CSS input, arbitrary fonts per template, right-to-left shaping, CJK.
- Arithmetic, number or date formatting inside layouts (send formatted values).
- Fillable forms, digital signatures, encryption, PDF/A.
- Queued (asynchronous) rendering: requests over `RENDER_CONCURRENCY` are refused with 429.

## Audit events

With `AUDIT_URL` and `AUDIT_API_KEY` set, every completed write and render is forwarded as one event (`success`, or `denied` on 403) with the calling key as actor (or, for an `ACTOR_KEYS` key sending `X-Actor`, that admin as actor and the key in `meta.via`): `atc-render.template.create|update|delete`, `atc-render.version.create` (meta: version), `atc-render.document.render` (target: template; meta: version, store), `atc-render.document.preview`. Render data never appears in events. Details: [examples/audit-events.md](examples/audit-events.md).

## Scaling model

**B — single-node stateful.** Templates and the render log are one SQLite file (`instances: 1`); rendering is bounded by `RENDER_CONCURRENCY` per process. See [docs/READINESS.md](docs/READINESS.md).

## Observability

Request logs with request id and trace context; `/metrics` (templates, renders and failures by code in 24 h, average ms, pages, bytes, in-flight, busy refusals); `/v1/stats`; `/ready`. See [docs/READINESS.md](docs/READINESS.md).

Audit forwarding is observable too: `audit_forward_enabled`, `audit_forward_events_total{result="recorded|sent|dropped|failed"}` and `audit_forward_pending`. A rising `dropped`, or a `pending` that does not drain, means audit events are being lost or delayed; alert on it.

## Backup / restore

The SQLite file at `DB_PATH` holds templates, versions and the render log; stored PDFs are in atc-media. `sqlite3 data/render.db "VACUUM INTO 'backup.db'"` takes an online copy. Restore by stopping the service, replacing the file and starting again. Migrations are not reversible.

## License

MIT, see [LICENSE](LICENSE). The fonts in `fonts/` are under their own license, see [fonts/LICENSE-DejaVu.txt](fonts/LICENSE-DejaVu.txt).
