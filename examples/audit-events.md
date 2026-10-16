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
| `atc-render.job.create` | `POST /v1/renders` | `{ type: "job", id }` | `template`, `version`, `store` |
| `atc-render.job.cancel` | `POST /v1/renders/:id/cancel` | `{ type: "job", id }` | – |


## Who is the actor

The actor is the calling API key (`{ "type": "apikey", "id": "<key id>" }`). When the key is listed in `ACTOR_KEYS` (the console) and sends a valid `X-Actor` header, the event names that person instead, and the key moves to `meta.via`:

```json
{ "action": "atc-render.template.create", "actor": { "type": "admin", "id": "ayse.k" }, "meta": { "via": "atc-console" } }
```

`X-Actor` from any other key is ignored; its events keep the key as actor.
