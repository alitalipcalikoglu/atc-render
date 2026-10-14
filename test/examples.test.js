import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { PdfText } from './pdf-text.js';
import { RW_KEY, bearer, buildApp, fakeMedia } from './helpers.js';

/** @param {string} name */
const md = (name) => readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8');
/** @type {Awaited<ReturnType<typeof fakeMedia>>} */ let media;
before(async () => { media = await fakeMedia(); media.state.files.set('f_3b1c0d2e', media.state.files.get('logo') ?? Buffer.alloc(0)); });
after(() => media.close());

test('examples: the invoice, certificate and report layouts validate and render as documented', async (t) => {
  const { app } = await buildApp(media.url);
  t.after(() => app.close());
  const h = bearer(RW_KEY);
  /** @param {string} s @param {RegExp} re */
  const match = (s, re) => { const m = re.exec(s); assert.ok(m, `example block not found: ${re}`); return JSON.parse(m[1]); };
  const heredoc = (/** @type {string} */ s) => match(s, /<<'JSON'\n([\s\S]*?)\nJSON/);
  const inline = (/** @type {string} */ s, /** @type {RegExp} */ re) => match(s, re);

  const invoice = heredoc(md('invoice.md'));
  const invoiceData = inline(md('invoice.md'), /-o F-2026-0042\.pdf -d '([\s\S]*?)'\n```/).data;
  let res = await app.inject({ method: 'POST', url: '/v1/render/preview', headers: h, payload: { layout: invoice.layout, data: invoiceData } });
  assert.equal(res.statusCode, 200, res.body);
  const text = PdfText.pages(res.rawPayload)[0];
  for (const s of ['Fatura F-2026-0042', 'Örnek Yazılım A.Ş.', 'Ayşe Yılmaz', 'Danışmanlık (Ekim)', '12.000,00 ₺', 'Sayfa 1 / 1']) assert.ok(text.includes(s), s);
  assert.equal(text.includes('**'), false, 'the documented invoice prints no markup asterisks');

  const cert = heredoc(md('certificate.md'));
  const certData = inline(md('certificate.md'), /-d '([\s\S]*?)'\n# 201/).data;
  res = await app.inject({ method: 'POST', url: '/v1/render/preview', headers: h, payload: { layout: cert.layout, data: certData } });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(PdfText.pages(res.rawPayload)[0], /Üstün başarı/);

  const report = inline(md('report.md'), /-o report\.pdf -d '([\s\S]*?)'\n```/);
  report.data.orders = Array.from({ length: 1200 }, (_, i) => ({ id: `S-${i + 1}`, customer: 'Çağrı Öztürk', city: 'İzmir', total: '349,90' }));
  res = await app.inject({ method: 'POST', url: '/v1/render/preview', headers: h, payload: report });
  assert.equal(res.statusCode, 200, res.body);
  const pages = PdfText.pages(res.rawPayload);
  assert.ok(pages.length >= 20 && pages.length <= 50, `${pages.length} pages`);
  assert.ok(pages.every((p) => p.includes('Müşteri')), 'header row on every page');
  assert.match(pages.at(-1) ?? '', new RegExp(`${pages.length} / ${pages.length}`));
  assert.match(pages[0], /349,90 ₺/);
});
