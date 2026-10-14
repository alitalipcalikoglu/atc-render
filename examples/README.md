# render examples

Scenario-driven walkthroughs of every feature. Requests to `/v1/*` need `Authorization: Bearer <secret>` from `RENDER_API_KEYS`. Base URL below is `http://localhost:3015`.

| Example | Shows |
|---|---|
| [Layouts and blocks](layouts.md) | Page setup, header/footer with page numbers, every block type, placeholders, markup, `if` |
| [Invoice](invoice.md) | A Turkish invoice: company block, key/value details, line-item table, totals, QR payment link |
| [Certificate](certificate.md) | Landscape A4, centred text, a logo from atc-media, conditional honours line |
| [Report with a long table](report.md) | Table across many pages with repeated header and zebra rows, page numbers |
| [Templates and versions](templates.md) | Creating, publishing immutable versions, rendering an older version, deleting |
| [Rendering and storing](rendering.md) | Direct PDF download, `store: true` into media with a signed URL, previews of unsaved layouts |
| [Errors and limits](limits.md) | Validation paths, 422 with block paths, page/data/image caps, timeouts, 429 |
| [Fonts and languages](fonts.md) | The embedded DejaVu family, Turkish and other scripts, mono text |
| [API keys and roles](keys-and-roles.md) | Read renders, write designs |
| [Operations](operations.md) | Health, readiness, metrics, stats, PM2, Docker |
| [Audit events](audit-events.md) | Which actions are forwarded to the audit service |

Set up once for the examples:

```bash
export RENDER=http://localhost:3015
export KEY=<a readwrite secret from RENDER_API_KEYS>
alias rcurl='curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json"'
```
