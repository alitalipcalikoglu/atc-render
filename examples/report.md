# Report with a long table

```bash
rcurl -X POST $RENDER/v1/render/preview -o report.pdf -d '{
  "layout": {
    "page": { "size": "A4", "orientation": "landscape" },
    "header": { "text": "Aylık sipariş raporu · {{month}}", "align": "left" },
    "footer": { "text": "{{page}} / {{pages}}", "align": "right" },
    "blocks": [
      { "type": "heading", "level": 2, "text": "Siparişler ({{count}})" },
      { "type": "table", "rows": "orders", "zebra": true, "fontSize": 8, "empty": "Bu ay sipariş yok.",
        "columns": [
          { "header": "No", "value": "{{id}}", "width": 1 },
          { "header": "Müşteri", "value": "{{customer}}", "width": 3 },
          { "header": "Şehir", "value": "{{city}}", "width": 2 },
          { "header": "Tutar", "value": "{{total}} {{currency}}", "width": 1.5, "align": "right" }
        ] }
    ]
  },
  "data": { "month": "Ekim 2026", "count": 1200, "currency": "₺", "orders": [ { "id": "S-1", "customer": "Çağrı Öztürk", "city": "İzmir", "total": "349,90" } ] }
}'
```

With 1 200 orders this is about 30 pages: the header row is repeated at the top of every page, rows never split across pages, every second row is shaded, and the footer shows `12 / 30`. `{{currency}}` is not in the row, so it comes from the top-level data.

Limits that matter here: `MAX_TABLE_ROWS` (5 000 per table), `MAX_PAGES` (50), `MAX_DATA_BYTES` (256 KiB of JSON) and `RENDER_TIMEOUT_MS` (15 s). A 30-page table renders in well under a second.
