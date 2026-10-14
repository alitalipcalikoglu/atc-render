# API keys and roles

`RENDER_API_KEYS=id:secret[:role]`; secrets at least 32 characters.

| Role | Can |
|---|---|
| `read` | render stored templates (also `store: true`), list and read templates and versions, stats, metrics |
| `write` | create, describe, publish versions, delete templates; preview unsaved layouts |
| `readwrite` (default) | both |

```
RENDER_API_KEYS=atc-console:<64 hex>,billing-backend:<64 hex>:read,designer-tool:<64 hex>:write
```

A backend that only produces documents holds a `read` key: it can render but never change what a template says.
