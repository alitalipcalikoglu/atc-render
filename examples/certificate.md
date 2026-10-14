# Certificate

Landscape, centred, with a logo stored in atc-media (needs `MEDIA_URL` / `MEDIA_API_KEY`).

```bash
rcurl -X POST $RENDER/v1/templates -d @- <<'JSON'
{
  "name": "certificate",
  "layout": {
    "page": { "size": "A4", "orientation": "landscape", "margins": { "top": 72, "right": 72, "bottom": 72, "left": 72 }, "fontSize": 14 },
    "blocks": [
      { "type": "image", "fileId": "f_3b1c0d2e", "height": 60, "align": "center" },
      { "type": "spacer", "height": 30 },
      { "type": "heading", "level": 1, "text": "Katılım Sertifikası", "align": "center" },
      { "type": "text", "text": "Bu belge **{{name}}** adına, _{{course}}_ eğitimini {{date}} tarihinde tamamladığını gösterir.", "align": "center" },
      { "type": "text", "if": "honours", "text": "**Üstün başarı** ile", "align": "center", "color": "#8a5a00" },
      { "type": "spacer", "height": 40 },
      { "type": "qr", "value": "https://verify.example.com/c/{{certificateId}}", "size": 70, "align": "center" },
      { "type": "text", "text": "Doğrulama: {{certificateId}}", "align": "center", "fontSize": 8 }
    ]
  }
}
JSON
```

`fileId` is a literal atc-media file id, not a placeholder (upload the logo once, put its id here). The image is fetched server-side through `MEDIA_URL`. To vary the image per render, use one template per logo or base64 `data`.

Render and store it for the participant:

```bash
rcurl -X POST $RENDER/v1/render -d '{ "template": "certificate", "store": true, "filename": "sertifika-ayse", "data": { "name": "Ayşe Yılmaz", "course": "Güvenli Yazılım Geliştirme", "date": "14.10.2026", "honours": true, "certificateId": "C-7781" } }'
# 201 { "fileId": "f_9a...", "url": "https://media.example.com/files/f_9a.../original?exp=...&sig=...", "expiresAt": "...", "pages": 1, "bytes": 61234, "version": 1 }
```
