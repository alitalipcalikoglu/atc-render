# Operations

```bash
curl -s $RENDER/health       # {"status":"ok"}
curl -s $RENDER/ready        # {"status":"ok"}  database ping, cached 10 s
curl -s $RENDER/v1/info      # capabilities: pdf, versioned-templates, unicode-fonts, tables, qr, images-base64 (+ images-media, store-media)
rcurl $RENDER/v1/stats       # templates, last24h { renders, succeeded, failed, avgMs, pages, bytes, stored, errors, byTemplate }
rcurl $RENDER/metrics
```

```
render_templates 4
render_renders_24h{outcome="succeeded"} 812
render_failures_24h{code="RENDER_FAILED"} 3
render_avg_ms_24h 41
render_pages_24h 1960
render_in_flight 1
render_busy_total 0
```

## Running

```bash
cp .env.example .env
npm ci --omit=dev
pm2 start ecosystem.config.cjs
```

Docker copies `fonts/` into the image:

```bash
docker build -t atc-render .
docker run -d -p 3015:3015 -v render-data:/data --env-file .env atc-render
```

## Capacity

Rendering is CPU work in the service process. `RENDER_CONCURRENCY` (4) bounds parallel renders; above it requests get `429 BUSY` instead of queueing. Each render holds its PDF in memory up to `MAX_PDF_BYTES`. The render log (stats) is pruned after `RENDER_LOG_DAYS` (30).

## Backups

The SQLite file at `DB_PATH` holds templates, versions and the render log. Stored PDFs live in atc-media.
