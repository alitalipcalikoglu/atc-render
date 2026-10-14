# Fonts and languages

Every document uses the DejaVu family, shipped in [`fonts/`](../fonts) with its license (`fonts/LICENSE-DejaVu.txt`, Bitstream Vera license plus public-domain changes): DejaVu Sans regular, bold, oblique and bold oblique for text, DejaVu Sans Mono for `mono` runs. The fonts are read from disk at render time and never fetched; each PDF embeds only the glyphs it uses (a subset), so a one-page document stays small.

DejaVu covers Latin (including Turkish `ş ğ ı İ ç ö ü`, `₺`), Greek, Cyrillic, Armenian, Georgian, Hebrew and Arabic glyphs; right-to-left shaping and CJK are not supported.

```json
{ "type": "text", "runs": [ { "text": "Kod: " }, { "text": "TR-İŞ-001", "mono": true }, { "text": " — onaylandı", "italic": true } ] }
```

Text in the PDF carries a Unicode map, so it can be selected, searched and copied, and screen readers read it.
