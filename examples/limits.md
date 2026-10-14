# Errors and limits

## The layout does not match the schema: 400

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "body/layout/blocks/1/level must be equal to one of the allowed values",
  "details": [ { "path": "/layout/blocks/1/level", "message": "must be equal to one of the allowed values" } ] } }
```

`path` points at the block (`/layout/blocks/1`). A block of an unknown `type` fails the `oneOf` of all block shapes.

## The layout is valid but cannot be drawn with this data: 422

```json
{ "error": { "code": "RENDER_FAILED", "message": "\"lines\" is not an array in data", "details": { "block": "blocks[3].rows" } } }
```

| Code | When |
|---|---|
| `RENDER_FAILED` | table `rows` not an array, a row taller than a page, too many rows, QR value too long (213 bytes), media file not found |
| `TOO_MANY_PAGES` | more than `MAX_PAGES` (50) |
| `TOO_MANY_IMAGES` | more than `MAX_IMAGES` (20) image blocks drawn |
| `IMAGE_TOO_LARGE` | an image over `MAX_IMAGE_BYTES` (2 MiB) or all images over `MAX_TOTAL_IMAGE_BYTES` (10 MiB) |
| `IMAGE_UNSUPPORTED` | not PNG or JPEG (checked by magic bytes) |
| `RENDER_TIMEOUT` | over `RENDER_TIMEOUT_MS` (15 s), checked between blocks and every 50 table rows |
| `PDF_TOO_LARGE` | output over `MAX_PDF_BYTES` (20 MiB) |

## Other

- `413 DATA_TOO_LARGE` / `LAYOUT_TOO_LARGE`: JSON of `data` over `MAX_DATA_BYTES` (256 KiB) or a layout over `MAX_LAYOUT_BYTES` (128 KiB).
- `429 BUSY`: all `RENDER_CONCURRENCY` (4) slots are rendering; retry after a moment. `429 RATE_LIMITED` is the per-key limit.
- `502 MEDIA_ERROR`: media could not store or sign.

Images behind a false `if` are neither fetched nor counted.
