# Audit events

Set both variables to forward events to the audit service; leave both empty to keep the service silent:

```
AUDIT_URL=http://10.0.0.5:3005
AUDIT_API_KEY=<the render key from AUDIT_API_KEYS, role write>
```

One event per completed request (`success`, or `denied` on 403). Validation failures are not events. Data sent for rendering never appears in events.

| Action | Request | Target | `meta` |
|---|---|---|---|
| `atc-render.template.create` | `POST /v1/templates` | template | `version` |
| `atc-render.template.update` | `PATCH /v1/templates/:name` | template | |
| `atc-render.template.delete` | `DELETE /v1/templates/:name` | template | |
| `atc-render.version.create` | `POST /v1/templates/:name/versions` | template | `version` |
| `atc-render.document.render` | `POST /v1/render` | template | `version` (or `latest`), `store` |
| `atc-render.document.preview` | `POST /v1/render/preview` | `{ type: "layout", id: "preview" }` | |
