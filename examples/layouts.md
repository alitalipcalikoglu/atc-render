# Layouts and blocks

A layout is JSON: optional `page`, `header`, `footer`, and an ordered `blocks` list. The schema is `components.schemas.Layout` in [openapi.yaml](../openapi.yaml); anything not in it is rejected.

```json
{
  "page": { "size": "A4", "orientation": "portrait", "margins": { "top": 56, "right": 56, "bottom": 56, "left": 56 }, "fontSize": 10 },
  "header": { "text": "{{company.name}}", "align": "right" },
  "footer": { "text": "Sayfa {{page}} / {{pages}}", "align": "center" },
  "blocks": [ { "type": "heading", "level": 1, "text": "Fatura {{number}}" } ]
}
```

Sizes `A4`, `Letter`, `A5`; margins in points (18–144, 72 pt = 1 inch). Header and footer are drawn in the top and bottom margins of every page; `{{page}}` and `{{pages}}` are the page number and total.

## Blocks

| Block | Fields |
|---|---|
| `heading` | `text`, `level` 1–3, `align`, `color` (`#RRGGBB`) |
| `text` | `text` with `**bold**` and `_italic_`, or `runs: [{ text, bold, italic, mono, color }]`; `align` (also `justify`), `fontSize`, `color` |
| `keyValue` | `items: [{ label, value, if }]`, `labelWidth` (fraction of the width, default 0.35) |
| `table` | `rows` (data path of an array), `columns: [{ header, value, width, align }]`, `zebra`, `fontSize`, `empty` (text when there are no rows) |
| `image` | `fileId` (atc-media) **or** `data` (base64 PNG/JPEG); `width`, `height`, `align` |
| `qr` | `value`, `size` (40–400 pt), `align` |
| `divider` | `color` |
| `spacer` | `height` (pt) |
| `pageBreak` | – |

Every block (and every `keyValue` item) may carry `if`: a data path rendered only when it is truthy (non-empty string or array, non-zero number, `true`); `"if": "!paid"` negates.

## Placeholders

`{{path}}` reads `data` by dot path (`{{customer.address.city}}`, `{{items.0.name}}`). Missing values print nothing. Inside a table column, a path is looked up in the row first and then in the whole data: `{{name}}` is the row's name, `{{currency}}` can come from the top level. Only own properties are read; `{{constructor}}` and the like print nothing.

Markup is applied to the layout text before placeholders are filled, so data containing `**` or `_` is printed literally and never changes formatting. `_italic_` needs word boundaries: `snake_case_word` stays as it is.

## Pitfalls

- A `text` block needs `text` or `runs`; an `image` exactly one of `fileId` and `data`.
- There is no arithmetic or number formatting: send values formatted (`"1.250,00 ₺"`).
- A table row taller than a page is an error (`RENDER_FAILED`, `blocks[n].rows[i]`).
