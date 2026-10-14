# `atc-render` readiness contract

## Purpose
`atc-render` produces PDFs from versioned JSON layout templates (headings, text with
placeholders and inline bold/italic, key/value lists, tables across pages, images, QR codes,
header/footer with page numbers) and either returns them or stores them as private atc-media
files. Fonts (DejaVu) are vendored in `fonts/`.

## Dependencies
- **atc-media** (`MEDIA_URL` + `MEDIA_API_KEY`, optional): image blocks by file id and
  `store: true`. Its only network peer; signed URLs are fetched through `MEDIA_URL` regardless of
  the host they name, without following redirects. Without it those two features answer
  `400 MEDIA_DISABLED`; everything else works.
- **atc-audit** (`AUDIT_URL` + `AUDIT_API_KEY`, optional): event forwarding, off the request path.
- Runtime library: `pdfkit` 0.20.2 (pure JS; brings fontkit, linebreak, png-js, fflate,
  @noble/hashes, @noble/ciphers). It is only ever given Buffers, never paths or URLs.

## Persistence
SQLite at `DB_PATH` (`./data/render.db`; Docker `/data/render.db`): `templates`,
`template_versions` (immutable rows, pruned beyond `MAX_VERSIONS`), `renders` (one row per render
attempt for stats, pruned after `RENDER_LOG_DAYS`). Migrations by `user_version`, snapshot before
upgrading an existing file, no down migrations.

## Health endpoint
`GET /health`: `{ status: 'ok' }`, no I/O.

## Readiness endpoint
`GET /ready`: `db.ping()` cached 10 s. Media is not probed.

## Graceful shutdown
`SIGTERM`/`SIGINT`: stop the retention timer → HTTP drains (in-flight renders finish, bounded by
`RENDER_TIMEOUT_MS` 15 s) → audit flush → database closes. Force exit at 30 s; PM2 `kill_timeout` 35 s.

## Resource limits
`MAX_PAGES` 50, `MAX_DATA_BYTES` 256 KiB, `MAX_LAYOUT_BYTES` 128 KiB, `MAX_TABLE_ROWS` 5 000,
`MAX_IMAGES` 20, `MAX_IMAGE_BYTES` 2 MiB, `MAX_TOTAL_IMAGE_BYTES` 10 MiB, `MAX_PDF_BYTES` 20 MiB,
`BODY_LIMIT` 4 MiB, `RENDER_CONCURRENCY` 4 (more answer `429 BUSY`, no queue),
`RATE_LIMIT_MAX` 600/min per key, PM2 `max_memory_restart` 300 MB. A render holds its PDF in
memory (≤ `MAX_PDF_BYTES`) and its images (≤ `MAX_TOTAL_IMAGE_BYTES`).

## Timeouts
`RENDER_TIMEOUT_MS` 15 s per render (image fetches abort; drawing checks the deadline between
blocks and every 50 table rows; a single block is not interrupted). `MEDIA_TIMEOUT_MS` 10 s per
media call.

## Retry policy
None. A failed media call fails the render (`MEDIA_ERROR` 502 or `RENDER_FAILED` 422); callers retry.

## Idempotency
Rendering is deterministic for a version and data apart from the PDF creation date; `store: true`
creates a new media file every time. `POST /v1/templates` is not idempotent (409 on repeat);
publishing a version always adds a number.

## Backup
The SQLite file. Stored PDFs live in media.

## Restore
Stop, replace `DB_PATH`, start. Forward migrations apply automatically.

## Metrics
`render_templates`, `render_renders_24h{outcome}`, `render_failures_24h{code}`,
`render_avg_ms_24h`, `render_pages_24h`, `render_bytes_24h` (database);
`render_in_flight`, `render_busy_total`, `render_process_uptime_seconds` (process-local).

## Logging
Fastify request logs with request id and trace context, `authorization` redacted. Render data is
never logged.

## Tracing
`X-Request-Id` accepted or generated; `traceparent` continued when `TRUST_PROXY=true`.

## Security model
Bearer keys: `read` renders, `write` manages templates and previews. Layouts are validated against
a closed JSON schema (unknown blocks and fields rejected). Placeholders read own properties only
(no prototype access) and are filled after markup parsing (data cannot change formatting).
pdfkit never receives a file path or URL: images are fetched by the service from `MEDIA_URL` only
(or decoded from base64), size-capped and checked by magic bytes (PNG/JPEG). PDFs are returned as
attachments with `content-security-policy: default-src 'none'; sandbox`. No JavaScript, links or
form fields are written into PDFs.

## Scaling model
**A — stateless rendering with a small stateful catalog.** Rendering is CPU-bound and per
process; templates and the render log are in one SQLite file, so one process per file
(`instances: 1`). Scale out with more hosts, each with its own catalog, or by splitting traffic.

## Known failure modes
- **Many large renders at once**: requests beyond `RENDER_CONCURRENCY` get `429 BUSY`.
- **A pathological single block** (huge text) can exceed `RENDER_TIMEOUT_MS` before the next check;
  the layout and data caps bound it.
- **Media down**: image-by-id and stored renders fail with 502/422; base64 images and direct
  downloads keep working.
