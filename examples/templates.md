# Templates and versions

```bash
rcurl -X POST $RENDER/v1/templates -d '{ "name": "invoice", "description": "Invoices", "layout": { "blocks": [ { "type": "text", "text": "v1" } ] }, "note": "first draft" }'
# 201 { "template": { "name": "invoice", "latestVersion": 1, ... } }

rcurl -X POST $RENDER/v1/templates/invoice/versions -d '{ "layout": { "blocks": [ { "type": "text", "text": "v2" } ] }, "note": "new wording" }'
# 201 { "version": { "version": 2, "note": "new wording", "layout": { ... } } }

rcurl $RENDER/v1/templates/invoice                 # template + versions (newest first, no layouts)
rcurl $RENDER/v1/templates/invoice/versions/1      # one version with its layout
rcurl -X PATCH $RENDER/v1/templates/invoice -d '{ "description": "Customer invoices" }'
```

Versions are immutable: changing a layout always publishes a new number, and renders without `version` use the latest. Pin a version in callers that must not change (`{ "template": "invoice", "version": 2 }`); unpin to follow the latest. Versions beyond `MAX_VERSIONS` (100) are pruned, oldest first; numbers are never reused.

```bash
rcurl -X DELETE $RENDER/v1/templates/invoice      # 204: the template and every version
```

Deleting does not touch PDFs already stored in media.
