# Rendering and storing

## Download directly

```bash
rcurl -X POST $RENDER/v1/render -o out.pdf -D - -d '{ "template": "invoice", "data": { "number": "F-1" }, "filename": "Fatura F-1" }'
```

```
content-type: application/pdf
content-disposition: attachment; filename="Fatura-F-1.pdf"
content-security-policy: default-src 'none'; sandbox
x-render-pages: 1
x-render-ms: 38
```

The PDF is rendered completely (bounded by the limits) before anything is sent, so an error is always a proper JSON status, never a broken file.

## Store in media

```bash
rcurl -X POST $RENDER/v1/render -d '{ "template": "invoice", "data": { "number": "F-1" }, "store": true }'
# 201 { "fileId": "f_8c1...", "url": "https://media.example.com/files/f_8c1.../original?exp=...&sig=...", "expiresAt": "2026-10-14T09:05:00.000Z", "pages": 1, "bytes": 31877, "version": 3 }
```

The file is a private atc-media file named after `filename` (or `<template>-v<version>.pdf`). The URL is signed by media for `DOWNLOAD_TTL_SEC` (300 s); ask media for fresh URLs later with the `fileId`. Needs `MEDIA_URL`/`MEDIA_API_KEY` (`400 MEDIA_DISABLED` otherwise).

## Preview an unsaved layout

```bash
rcurl -X POST $RENDER/v1/render/preview -o preview.pdf -d '{ "layout": { "blocks": [ { "type": "heading", "text": "Deneme" } ] }, "data": {} }'
```

Write role only (it is how designers try layouts before publishing); never stored.
