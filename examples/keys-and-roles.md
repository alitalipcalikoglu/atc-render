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

## Acting person (`X-Actor`)

A key listed in `ACTOR_KEYS` may say who is behind a call:

```
ACTOR_KEYS=atc-console
```

```bash
curl -s -H "Authorization: Bearer $CONSOLE_KEY" -H "X-Actor: ayse.k" ...
```

Records created by that call carry `ayse.k` (in `createdBy`, `updatedBy`) instead of `atc-console`. The value must match `[A-Za-z0-9][A-Za-z0-9._@-]{0,63}`; anything else, and the header from any key not in the list, is ignored and the key id is recorded. Audit events keep the key as the actor. The console sends the signed-in admin's username.
