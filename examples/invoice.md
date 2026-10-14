# Invoice

## Template

```bash
rcurl -X POST $RENDER/v1/templates -d @- <<'JSON'
{
  "name": "invoice",
  "description": "Customer invoices (TR)",
  "layout": {
    "page": { "size": "A4", "margins": { "top": 60, "right": 50, "bottom": 60, "left": 50 } },
    "header": { "text": "{{company.name}} · Fatura {{number}}", "align": "right" },
    "footer": { "text": "Sayfa {{page}} / {{pages}}" },
    "blocks": [
      { "type": "heading", "level": 1, "text": "Fatura {{number}}" },
      { "type": "text", "text": "**{{company.name}}**\n{{company.address}}\nVergi no: {{company.taxId}}" },
      { "type": "divider" },
      { "type": "keyValue", "items": [
        { "label": "Müşteri", "value": "{{customer.name}}" },
        { "label": "Adres", "value": "{{customer.address}}" },
        { "label": "Tarih", "value": "{{date}}" },
        { "label": "Vade", "value": "{{dueDate}}", "if": "dueDate" }
      ] },
      { "type": "table", "rows": "lines", "zebra": true, "columns": [
        { "header": "Ürün / hizmet", "value": "{{description}}", "width": 4 },
        { "header": "Adet", "value": "{{quantity}}", "align": "right" },
        { "header": "Birim fiyat", "value": "{{unitPrice}}", "width": 1.5, "align": "right" },
        { "header": "Tutar", "value": "{{amount}}", "width": 1.5, "align": "right" }
      ] },
      { "type": "keyValue", "labelWidth": 0.7, "items": [
        { "label": "Ara toplam", "value": "{{subtotal}}" },
        { "label": "KDV %20", "value": "{{vat}}" },
        { "label": "Genel toplam", "value": "{{total}}" }
      ] },
      { "type": "text", "if": "paid", "text": "_Ödendi, teşekkür ederiz._" },
      { "type": "qr", "if": "!paid", "value": "{{payUrl}}", "size": 90, "align": "right" },
      { "type": "text", "if": "!paid", "text": "Ödemek için QR kodu okutun: {{payUrl}}", "fontSize": 8, "align": "right" }
    ]
  }
}
JSON
```

Pitfall: `keyValue` values are plain text. Markup such as `**{{total}}**` is not interpreted and would print the asterisks; only `text` blocks read `**bold**`/`_italic_`, so use a `text` block (or explicit `runs`) for a bold total.

## Render

```bash
rcurl -X POST $RENDER/v1/render -o F-2026-0042.pdf -d '{
  "template": "invoice", "filename": "F-2026-0042",
  "data": {
    "number": "F-2026-0042", "date": "14.10.2026", "dueDate": "13.11.2026", "paid": false, "payUrl": "https://pay.example.com/F-2026-0042",
    "company": { "name": "Örnek Yazılım A.Ş.", "address": "Büyükdere Cd. 1, Şişli / İstanbul", "taxId": "1234567890" },
    "customer": { "name": "Ayşe Yılmaz", "address": "Kordon Boyu 5, Girne" },
    "lines": [ { "description": "Danışmanlık (Ekim)", "quantity": "10 saat", "unitPrice": "1.000,00 ₺", "amount": "10.000,00 ₺" } ],
    "subtotal": "10.000,00 ₺", "vat": "2.000,00 ₺", "total": "12.000,00 ₺"
  }
}'
```

The response is `application/pdf` as an attachment named `F-2026-0042.pdf`, with `x-render-pages: 1`.
