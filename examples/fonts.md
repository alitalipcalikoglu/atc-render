# Fonts and languages

Every document uses the DejaVu family, shipped in [`fonts/`](../fonts) with its license (`fonts/LICENSE-DejaVu.txt`, Bitstream Vera license plus public-domain changes): DejaVu Sans regular, bold, oblique and bold oblique for text, DejaVu Sans Mono for `mono` runs. The fonts are read from disk at render time and never fetched; each PDF embeds only the glyphs it uses (a subset), so a one-page document stays small.

DejaVu covers Latin (including Turkish `ş ğ ı İ ç ö ü`, `₺`), Greek, Cyrillic, Armenian, Georgian, Hebrew and Arabic glyphs; right-to-left shaping is not supported. For CJK or a brand typeface, install a family in `FONTS_DIR` (below).

```json
{ "type": "text", "runs": [ { "text": "Kod: " }, { "text": "TR-İŞ-001", "mono": true }, { "text": " — onaylandı", "italic": true } ] }
```

Text in the PDF carries a Unicode map, so it can be selected, searched and copied, and screen readers read it.

## Your own fonts

Put TrueType or OpenType files in a directory and point `FONTS_DIR` at it:

```
/srv/render-fonts/
  Inter-Regular.ttf
  Inter-Bold.ttf
  Inter-Italic.ttf
  Inter-BoldItalic.ttf
  NotoSansJP.ttf
```

```
FONTS_DIR=/srv/render-fonts
```

Each family needs a regular face (`<Family>.ttf` or `<Family>-Regular.ttf`); missing bold or italic faces fall back to it, `-Oblique` counts as italic. The family id is the lower-cased file stem: `inter`, `notosansjp`. `sans`, `mono` and `dejavu` are reserved. Every file is opened at startup, so a broken file stops the service with a configuration error instead of failing renders later. Restart after adding fonts.

List what a layout can use:

```bash
curl "$RENDER/v1/fonts" -H "Authorization: Bearer $KEY"
```

```json
{ "default": "dejavu", "items": ["inter", "notosansjp"] }
```

Pick one for the whole document; headings, bold and italic runs, tables and the header/footer use its faces, `mono` runs stay DejaVu Sans Mono:

```json
{ "page": { "size": "A4", "font": "notosansjp" }, "blocks": [ { "type": "heading", "text": "請求書 {{no}}" }, { "type": "text", "text": "合計: {{total}}" } ] }
```

A layout naming a family that is not installed is refused when it is saved or previewed:

```json
{ "error": { "code": "UNKNOWN_FONT", "message": "font \"inter\" is not installed (FONTS_DIR)", "details": { "font": "inter", "installed": ["notosansjp"] } } }
```

Pitfalls:

- Check the font's license allows embedding in PDFs; only the used glyphs are embedded.
- In Docker, mount the directory (`-v /srv/render-fonts:/fonts:ro`, `FONTS_DIR=/fonts`); every instance needs the same files, or a template saved on one renders `UNKNOWN_FONT` on another.
- Removing a family that saved templates use makes their renders fail with `UNKNOWN_FONT`.
- CJK text wraps only at spaces and punctuation; insert spaces or keep lines short.
