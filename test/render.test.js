import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { RenderError } from '../src/domain/errors.js';
import { TemplateText } from '../src/domain/template-text.js';
import { PdfText } from './pdf-text.js';
import { PNG, fakeMedia, testSystem } from './helpers.js';

/** @param {string} code */
const fails = (code) => (/** @type {unknown} */ e) => e instanceof RenderError && e.code === code;
/** @type {Awaited<ReturnType<typeof fakeMedia>>} */ let media;
before(async () => { media = await fakeMedia(); });
after(() => media.close());

test('TemplateText: placeholders, own properties only, conditions, markup before data', () => {
  const data = { a: { b: [{ c: 'x' }] }, n: 0, list: [], name: '**not bold**' };
  assert.equal(TemplateText.fill('{{ a.b.0.c }}-{{n}}-{{missing}}', [data]), 'x-0-');
  assert.equal(TemplateText.fill('{{constructor}}{{__proto__}}{{a.toString}}', [data]), '', 'no prototype access');
  assert.equal(TemplateText.fill('{{c}}/{{n}}', [{ c: 'row' }, data]), 'row/0', 'row scope first, then data');
  assert.deepEqual([TemplateText.test('a', data), TemplateText.test('n', data), TemplateText.test('list', data), TemplateText.test('!list', data)], [true, false, false, true]);
  assert.deepEqual(TemplateText.runs('Hi **{{name}}**, _thanks_ a_b_c', [data]), [{ text: 'Hi ' }, { text: '**not bold**', bold: true }, { text: ', ' }, { text: 'thanks', italic: true }, { text: ' a_b_c' }]);
});

test('renders Turkish text with the embedded font, placeholders, conditions, header/footer page numbers', async () => {
  const { renderer } = testSystem(media.url);
  const layout = {
    header: { text: 'Fatura {{no}}', align: /** @type {const} */ ('right') },
    footer: { text: 'Sayfa {{page}} / {{pages}}' },
    blocks: [
      { type: 'heading', level: 1, text: 'Şirket Ğüzel İçöü {{no}}' },
      { type: 'text', text: 'Sayın **{{name}}**, _teşekkürler_.' },
      { type: 'text', if: 'paid', text: 'ÖDENDİ' },
      { type: 'text', if: '!paid', text: 'ÖDENMEDİ' },
      { type: 'keyValue', items: [{ label: 'Tutar', value: '{{total}}' }, { label: 'Gizli', value: 'x', if: 'nope' }] },
      { type: 'pageBreak' },
      { type: 'text', runs: [{ text: 'mono ', mono: true }, { text: 'çğış', bold: true, italic: true }] },
    ],
  };
  const { pdf, pages } = await renderer.render(layout, { no: 'F-1', name: 'Ayşe Yılmaz', total: '1.250,00 ₺', paid: false });
  assert.equal(pages, 2);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/BaseFont \/[A-Z]{6}\+DejaVuSans\b/, 'DejaVu subset embedded');
  const text = PdfText.pages(pdf);
  assert.match(text[0], /Şirket Ğüzel İçöü F-1/);
  assert.match(text[0], /Ayşe Yılmaz/);
  assert.match(text[0], /teşekkürler/);
  assert.match(text[0], /ÖDENMEDİ/);
  assert.doesNotMatch(text[0], /ÖDENDİ\n/);
  assert.match(text[0], /1\.250,00 ₺/);
  assert.doesNotMatch(text[0], /Gizli/);
  assert.match(text[0], /Fatura F-1/);
  assert.match(text[0], /Sayfa 1 \/ 2/);
  assert.match(text[1], /Sayfa 2 \/ 2/);
  assert.match(text[1], /çğış/);
});

test('tables break across pages and repeat the header; zebra; empty text; row and page caps', async () => {
  const { renderer } = testSystem(media.url, { MAX_PAGES: '3' });
  const items = Array.from({ length: 80 }, (_, i) => ({ name: `Ürün ${i}`, qty: i }));
  const layout = { blocks: [{ type: 'table', rows: 'items', zebra: true, columns: [{ header: 'Ürün adı', value: '{{name}}', width: 3 }, { header: 'Adet', value: '{{qty}} {{unit}}', align: /** @type {const} */ ('right') }] }] };
  const { pdf, pages } = await renderer.render(layout, { items, unit: 'ad' });
  assert.equal(pages, 3);
  const text = PdfText.pages(pdf);
  assert.ok(text.every((p) => /Ürün adı/.test(p)), 'header row on every page');
  assert.match(text[0], /Ürün 0\n/);
  assert.match(text[2], /Ürün 79\n/);
  assert.match(text[2], /79 ad/, 'row scope then data scope');
  const empty = await renderer.render({ blocks: [{ type: 'table', rows: 'items', empty: 'Kayıt yok', columns: [{ header: 'A', value: '{{a}}' }] }] }, { items: [] });
  assert.match(PdfText.pages(empty.pdf)[0], /Kayıt yok/);
  await assert.rejects(renderer.render(layout, { items: 'nope' }), (e) => fails('RENDER_FAILED')(e) && /** @type {any} */ (e).details.block === 'blocks[0].rows');
  await assert.rejects(renderer.render(layout, { items: Array.from({ length: 400 }, (_, i) => ({ name: String(i) })) }), (e) => fails('TOO_MANY_PAGES')(e) && /** @type {any} */ (e).details.block === 'blocks[0]');
  const tight = testSystem(media.url, { MAX_TABLE_ROWS: '10' });
  await assert.rejects(tight.renderer.render(layout, { items }), fails('RENDER_FAILED'));
});

test('images (base64 and media file id through MEDIA_URL), QR, divider, spacer; image caps', async () => {
  const { renderer } = testSystem(media.url, { MAX_IMAGES: '2', MAX_IMAGE_BYTES: '4096' });
  const layout = { blocks: [
    { type: 'image', data: PNG.toString('base64'), width: 60, align: /** @type {const} */ ('center') },
    { type: 'image', fileId: 'logo', height: 40 },
    { type: 'qr', value: 'https://example.com/{{id}}', size: 80 },
    { type: 'divider' }, { type: 'spacer', height: 20 }, { type: 'text', text: 'son' },
  ] };
  const { pdf } = await renderer.render(layout, { id: 'x1' });
  assert.equal((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length, 2);
  assert.ok(media.state.seen.includes('GET /files/logo/original?exp=1&sig=s'), 'signed URL fetched through MEDIA_URL, not the public host');
  await assert.rejects(renderer.render({ blocks: [{ type: 'image', fileId: 'text' }] }, {}), (e) => fails('IMAGE_UNSUPPORTED')(e) && /** @type {any} */ (e).details.block === 'blocks[0]');
  await assert.rejects(renderer.render({ blocks: [{ type: 'image', fileId: 'big' }] }, {}), fails('IMAGE_TOO_LARGE'));
  await assert.rejects(renderer.render({ blocks: [{ type: 'image', fileId: 'missing' }] }, {}), (e) => fails('RENDER_FAILED')(e) && /not found/.test(/** @type {Error} */ (e).message));
  const three = { blocks: [0, 1, 2].map(() => ({ type: 'image', data: PNG.toString('base64') })) };
  await assert.rejects(renderer.render(three, {}), (e) => fails('TOO_MANY_IMAGES')(e) && /** @type {any} */ (e).details.block === 'blocks[2]');
  assert.ok((await renderer.render({ blocks: [...three.blocks.slice(0, 2), { type: 'image', if: 'show', data: PNG.toString('base64') }] }, {})).pdf.length > 0, 'images behind a false condition are not loaded or counted');
  await assert.rejects(renderer.render({ blocks: [{ type: 'qr', value: 'x'.repeat(300) }] }, {}), fails('RENDER_FAILED'));
  const noMedia = testSystem(media.url, { MEDIA_URL: '', MEDIA_API_KEY: '' });
  await assert.rejects(noMedia.renderer.render({ blocks: [{ type: 'image', fileId: 'logo' }] }, {}), fails('MEDIA_DISABLED'));
});

test('render timeout is enforced between blocks', async () => {
  let t = 0;
  const { renderer } = testSystem(media.url, { RENDER_TIMEOUT_MS: '1000' }, { now: () => (t += 600) });
  await assert.rejects(renderer.render({ blocks: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, {}), (e) => fails('RENDER_TIMEOUT')(e) && /** @type {any} */ (e).details.block === 'blocks[1]');
});

test('RenderService: versions are immutable and numbered, data cap, concurrency, store in media, stats', async () => {
  const { service, templates } = testSystem(media.url, { MAX_DATA_BYTES: '2048', RENDER_CONCURRENCY: '1', MAX_VERSIONS: '2' });
  const layout = { blocks: [{ type: 'text', text: 'v{{v}}' }] };
  service.create({ name: 'invoice', layout, description: 'Invoices' }, 'console');
  assert.throws(() => service.create({ name: 'invoice', layout }, 'x'), fails('TEMPLATE_EXISTS'));
  assert.throws(() => service.create({ name: 'Bad Name', layout }, 'x'), fails('INVALID_LAYOUT'));
  const v2 = service.publish('invoice', { layout: { blocks: [{ type: 'text', text: 'second {{v}}' }] }, note: 'wording' }, 'x');
  assert.equal(v2.version, 2);
  assert.equal(JSON.parse(/** @type {any} */ (templates.version('invoice', 1)).layout).blocks[0].text, 'v{{v}}', 'v1 unchanged');
  service.publish('invoice', { layout }, 'x');
  assert.equal(templates.version('invoice', 1), undefined, 'pruned past MAX_VERSIONS');
  assert.throws(() => service.version('invoice', 1), fails('VERSION_NOT_FOUND'));
  const latest = await service.render({ template: 'invoice', data: { v: 7 } }, 'billing');
  assert.deepEqual([latest.version, latest.filename, latest.stored], [3, 'invoice-v3.pdf', null]);
  assert.match(PdfText.pages(latest.pdf)[0], /v7/);
  const old = await service.render({ template: 'invoice', version: 2, data: { v: 7 }, filename: 'Fatura Ağustos/../x' }, 'billing');
  assert.equal(old.filename, 'Fatura-A-ustos-..-x.pdf');
  assert.match(PdfText.pages(old.pdf)[0], /second 7/);
  await assert.rejects(service.render({ template: 'invoice', data: { big: 'x'.repeat(3000) } }, 'b'), fails('DATA_TOO_LARGE'));
  const stored = await service.render({ template: 'invoice', store: true, data: {} }, 'b');
  assert.deepEqual([stored.stored?.fileId, stored.stored?.expiresAt, media.state.uploads.at(-1)?.type, media.state.uploads.at(-1)?.name], ['up1', '2030-01-01T00:00:00.000Z', 'application/pdf', 'invoice-v3.pdf']);
  // Concurrency: a second render while one runs gets BUSY.
  const slow = service.render({ template: 'invoice', data: {} }, 'b');
  await assert.rejects(service.render({ template: 'invoice', data: {} }, 'b'), fails('BUSY'));
  await slow;
  await assert.rejects(service.render({ template: 'nope' }, 'b'), fails('TEMPLATE_NOT_FOUND'));
  const st = service.stats();
  assert.equal(st.templates, 1);
  assert.deepEqual([st.last24h.succeeded, st.last24h.failed, st.last24h.stored, st.last24h.errors], [4, 1, 1, { DATA_TOO_LARGE: 1 }]);
  assert.ok(st.last24h.pages >= 4 && st.last24h.avgMs >= 0);
  service.delete('invoice');
  assert.throws(() => service.template('invoice'), fails('TEMPLATE_NOT_FOUND'));
});
