# Asynchronous renders

A synchronous `POST /v1/render` holds the HTTP request until the PDF is drawn and answers `429 BUSY` when every `RENDER_CONCURRENCY` slot is taken. For large reports, batch runs or callers with short timeouts, queue the render instead.

## Queue a job

Same body as `/v1/render`, role `read`:

```bash
curl -X POST "$RENDER/v1/renders" -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{ "template": "monthly-report", "data": { "month": "2026-09", "rows": [ … ] }, "filename": "report-2026-09" }'
```

`202` with a `location: /v1/renders/<id>` header:

```json
{ "job": { "id": "rnd_mv7q2b1k9c4e7a0d3f6b2e81", "status": "queued", "template": "monthly-report", "version": 4, "filename": "report-2026-09.pdf", "store": false,
  "createdBy": "billing", "createdAt": "2026-10-16T08:00:00.000Z", "startedAt": null, "finishedAt": null, "pages": null, "bytes": null, "error": null, "result": null } }
```

The template version is pinned now: publishing version 5 while the job waits does not change it. Template, data size and `store` without media are checked at submit and answer the same errors as `/v1/render`.

## Poll

```bash
curl "$RENDER/v1/renders/rnd_mv7q2b1k9c4e7a0d3f6b2e81" -H "Authorization: Bearer $KEY"
```

`status` moves `queued` → `running` → `succeeded` or `failed`. Poll every one or two seconds; a job never takes longer than `RENDER_TIMEOUT_MS` once it runs.

Succeeded:

```json
{ "job": { "id": "rnd_mv7q2b1k9c4e7a0d3f6b2e81", "status": "succeeded", "pages": 37, "bytes": 412883, "result": { "download": "/v1/renders/rnd_mv7q2b1k9c4e7a0d3f6b2e81/pdf" }, "…": "…" } }
```

Failed (the same codes as synchronous renders, e.g. `TOO_MANY_PAGES` with the block path in the message):

```json
{ "job": { "id": "rnd_mv7q2b1k9c4e7a0d3f6b2e81", "status": "failed", "error": { "code": "TOO_MANY_PAGES", "message": "the document would exceed MAX_PAGES (50)" }, "result": null, "…": "…" } }
```

## Download

```bash
curl -OJ "$RENDER/v1/renders/rnd_mv7q2b1k9c4e7a0d3f6b2e81/pdf" -H "Authorization: Bearer $KEY"
```

Before the job succeeds this answers `409 JOB_NOT_READY` with `details.status`.

## Store in media instead

With `"store": true` the finished PDF goes to atc-media as a private file and the job keeps only its id:

```json
"result": { "fileId": "8a4e…", "url": "https://media.example.com/files/8a4e…/original?exp=…&sig=…", "expiresAt": "2026-10-16T08:05:12.000Z" }
```

The URL expires after `DOWNLOAD_TTL_SEC`; later, ask atc-media for a new one with `POST /v1/files/<fileId>/urls`.

## List

```bash
curl "$RENDER/v1/renders?status=failed&limit=20" -H "Authorization: Bearer $KEY"
```

The answer is `{ items, nextCursor }`; pass `nextCursor` back as `&cursor=` for older jobs.

Only the submitting key sees its jobs; another key gets `404 JOB_NOT_FOUND`.

## Cancel

```bash
curl -X POST "$RENDER/v1/renders/rnd_mv7q2b1k9c4e7a0d3f6b2e81/cancel" -H "Authorization: Bearer $KEY"
```

Only a `queued` job is cancelled (`{ job }` with `status: "cancelled"`); a job already running finishes, and the call answers `409 INVALID_STATE`. Cancelled jobs stay in the list until retention removes them.

## Limits and retention

- `RENDER_JOB_CONCURRENCY` (default 1) jobs are drawn at once; each takes one of the `RENDER_CONCURRENCY` slots, so synchronous renders always keep the rest. When synchronous renders hold every slot, a job waits and retries; it does not fail.
- `RENDER_QUEUE_MAX` (default 100) queued plus running jobs; above that `POST /v1/renders` answers `429 QUEUE_FULL`.
- Finished jobs, including their PDFs, are deleted `RENDER_JOB_HOURS` (default 24) after they finish, by the hourly retention pass. Download or store before then.
- Jobs are in SQLite: a restart re-queues jobs that were running. Run one instance per database; two instances on one file would both draw the queue.
- `GET /v1/stats` has `jobs: { queued, running, succeeded, failed, concurrency, queueMax }`; `/metrics` has `render_jobs{status}`.
