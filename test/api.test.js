import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { LayoutSchema } from '../src/domain/layout-schema.js';
import { PdfText } from './pdf-text.js';
import { READ_KEY, RW_KEY, WRITE_KEY, bearer, buildApp, fakeMedia } from './helpers.js';

const json = (/** @type {import('light-my-request').Response} */ r) => JSON.parse(r.body);
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
/** @type {Awaited<ReturnType<typeof fakeMedia>>} */ let media;
before(async () => { media = await fakeMedia(); });
after(() => media.close());
const invoice = { page: { size: 'A4' }, footer: { text: 'Sayfa {{page}}/{{pages}}' }, blocks: [{ type: 'heading', level: 1, text: 'Fatura {{no}}' }, { type: 'table', rows: 'items', columns: [{ header: 'Ürün', value: '{{name}}' }, { header: 'Tutar', value: '{{price}}', align: 'right' }] }] };

test('API: probes, info, openapi matches the layout schema, roles', async (t) => {
  const { app } = await buildApp(media.url);
  t.after(() => app.close());
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/ready' })).statusCode, 200);
  const spec = await app.inject({ url: '/openapi.yaml' });
  assert.equal(spec.body, readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
  assert.ok(spec.body.includes(`    Layout: ${JSON.stringify(LayoutSchema.layout)}\n`), 'documented Layout schema is the one enforced (regenerate with scripts/openapi-layout.mjs)');
  const info = json(await app.inject({ url: '/v1/info' }));
  assert.deepEqual([info.service, info.version, info.capabilities.includes('store-media')], ['atc-render', PACKAGE_VERSION, true]);
  assert.equal((await app.inject({ url: '/v1/templates' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/templates', headers: bearer(WRITE_KEY) })).statusCode, 403, 'write-only cannot list');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/templates', headers: bearer(READ_KEY), payload: { name: 'x', layout: invoice } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/render/preview', headers: bearer(READ_KEY), payload: { layout: invoice } })).statusCode, 403, 'previews need write');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/render', headers: bearer(WRITE_KEY), payload: { template: 'x' } })).statusCode, 403, 'rendering needs read');
});

test('API: templates, versions, render to PDF and to media, preview, validation errors with block paths', async (t) => {
  const { app } = await buildApp(media.url);
  t.after(() => app.close());
  const h = bearer(RW_KEY);
  let res = await app.inject({ method: 'POST', url: '/v1/templates', headers: h, payload: { name: 'invoice', description: 'Faturalar', layout: invoice, note: 'first' } });
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual([json(res).template.latestVersion, res.headers.location], [1, '/v1/templates/invoice']);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/templates', headers: h, payload: { name: 'invoice', layout: invoice } })).statusCode, 409);
  res = await app.inject({ method: 'POST', url: '/v1/templates', headers: h, payload: { name: 'bad', layout: { blocks: [{ type: 'heading', text: 'x' }, { type: 'heading', level: 7, text: 'x' }] } } });
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).error.code, 'VALIDATION_FAILED');
  assert.ok(json(res).error.details.some((/** @type {any} */ d) => d.path.startsWith('/layout/blocks/1')), 'path names the bad block');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/templates', headers: h, payload: { name: 'bad', layout: { blocks: [{ type: 'image' }] } } })).statusCode, 400, 'image needs exactly one source');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/templates', headers: h, payload: { name: 'bad', layout: { blocks: [{ type: 'script', src: 'x' }] } } })).statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/v1/templates/invoice/versions', headers: h, payload: { layout: { ...invoice, blocks: [...invoice.blocks, { type: 'text', if: 'note', text: 'Not: {{note}}' }] }, note: 'with note' } });
  assert.deepEqual([res.statusCode, json(res).version.version], [201, 2]);
  res = await app.inject({ url: '/v1/templates/invoice', headers: bearer(READ_KEY) });
  assert.deepEqual(json(res).versions.map((/** @type {any} */ v) => [v.version, v.note]), [[2, 'with note'], [1, 'first']]);
  assert.equal(json(await app.inject({ url: '/v1/templates/invoice/versions/1', headers: h })).version.layout.blocks.length, 2);
  assert.equal((await app.inject({ url: '/v1/templates/invoice/versions/9', headers: h })).statusCode, 404);
  assert.equal(json(await app.inject({ method: 'PATCH', url: '/v1/templates/invoice', headers: h, payload: { description: 'Invoices' } })).template.description, 'Invoices');

  const data = { no: 'F-7', note: 'Teşekkürler', items: Array.from({ length: 70 }, (_, i) => ({ name: `Çay ${i}`, price: `${i},00 ₺` })) };
  res = await app.inject({ method: 'POST', url: '/v1/render', headers: bearer(READ_KEY), payload: { template: 'invoice', data, filename: 'Fatura F-7' } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="Fatura-F-7.pdf"');
  assert.equal(res.headers['content-security-policy'], "default-src 'none'; sandbox");
  assert.equal(res.headers['x-render-pages'], '2');
  const pages = PdfText.pages(res.rawPayload);
  assert.match(pages[0], /Fatura F-7/);
  assert.match(pages[1], /Teşekkürler/);
  assert.match(pages[1], /Sayfa 2\/2/);
  res = await app.inject({ method: 'POST', url: '/v1/render', headers: h, payload: { template: 'invoice', version: 1, data, store: true } });
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual([json(res).fileId, json(res).version, json(res).pages, json(res).url.startsWith('https://media.public.example/')], ['up1', 1, 2, true]);
  res = await app.inject({ method: 'POST', url: '/v1/render', headers: h, payload: { template: 'invoice', data: { items: 'x' } } });
  assert.deepEqual([res.statusCode, json(res).error.code, json(res).error.details.block], [422, 'RENDER_FAILED', 'blocks[1].rows']);
  res = await app.inject({ method: 'POST', url: '/v1/render/preview', headers: bearer(WRITE_KEY), payload: { layout: { blocks: [{ type: 'qr', value: '{{u}}' }, { type: 'text', text: 'Önizleme' }] }, data: { u: 'https://x' } } });
  assert.deepEqual([res.statusCode, res.headers['content-disposition']], [200, 'attachment; filename="preview.pdf"']);
  assert.match(PdfText.pages(res.rawPayload)[0], /Önizleme/);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/render', headers: h, payload: { template: 'nope' } })).statusCode, 404);

  const st = json(await app.inject({ url: '/v1/stats', headers: h }));
  assert.deepEqual([st.templates, st.last24h.succeeded, st.last24h.failed, st.last24h.stored, st.last24h.errors], [1, 3, 1, 1, { RENDER_FAILED: 1 }]);
  const m = (await app.inject({ url: '/metrics', headers: bearer(READ_KEY) })).body;
  assert.match(m, /^render_templates 1$/m);
  assert.match(m, /^render_renders_24h\{outcome="succeeded"\} 3$/m);
  assert.match(m, /^render_failures_24h\{code="RENDER_FAILED"\} 1$/m);
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/templates/invoice', headers: h })).statusCode, 204);
  assert.equal((await app.inject({ url: '/v1/templates/invoice', headers: h })).statusCode, 404);
});

test('API: limits — data size, layout size, concurrency 429', async (t) => {
  const { app, service } = await buildApp(media.url, { MAX_DATA_BYTES: '1024', MAX_LAYOUT_BYTES: '2048' });
  t.after(() => app.close());
  const h = bearer(RW_KEY);
  let res = await app.inject({ method: 'POST', url: '/v1/render/preview', headers: h, payload: { layout: { blocks: [{ type: 'text', text: 'x' }] }, data: { big: 'x'.repeat(2000) } } });
  assert.deepEqual([res.statusCode, json(res).error.code], [413, 'DATA_TOO_LARGE']);
  res = await app.inject({ method: 'POST', url: '/v1/render/preview', headers: h, payload: { layout: { blocks: [{ type: 'text', text: 'x'.repeat(3000) }] } } });
  assert.deepEqual([res.statusCode, json(res).error.code], [413, 'LAYOUT_TOO_LARGE']);
  service.active = service.limits.concurrency;
  res = await app.inject({ method: 'POST', url: '/v1/render/preview', headers: h, payload: { layout: { blocks: [{ type: 'text', text: 'x' }] } } });
  assert.deepEqual([res.statusCode, json(res).error.code], [429, 'BUSY']);
  service.active = 0;
});
