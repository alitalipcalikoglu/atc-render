import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { RenderError } from '../src/domain/errors.js';
import { ImageLoader } from '../src/pdf/images.js';
import { RenderPool } from '../src/pdf/render-pool.js';
import { Renderer } from '../src/pdf/renderer.js';
import { PdfText } from './pdf-text.js';
import { PNG, fakeMedia, testSystem } from './helpers.js';

/** @type {Awaited<ReturnType<typeof fakeMedia>>} */ let media;
before(async () => { media = await fakeMedia(); });
after(() => media.close());

/** A renderer drawing in a pool over the limits of the test system. */
function pooled(/** @type {Record<string, string>} */ env = {}, size = 2) {
  const { config, media: m } = testSystem(media.url, env);
  const pool = new RenderPool({ size, limits: config.limits, compress: false }).start();
  const renderer = new Renderer({ images: new ImageLoader({ media: m, limits: config.limits }), limits: config.limits, compress: false, pool });
  return { renderer, pool };
}
const fails = (/** @type {string} */ code) => (/** @type {unknown} */ e) => e instanceof RenderError && e.code === code;

test('pool: draws in a worker thread, same output as in-process; more jobs than workers queue and all finish', async () => {
  const { renderer, pool } = pooled({}, 2);
  try {
    const layout = { blocks: [{ type: 'heading', text: 'Merhaba {{name}}' }, { type: 'text', text: 'Çğış İÖÜ' }] };
    const inProcess = await testSystem(media.url).renderer.render(layout, { name: 'Ada' });
    const viaPool = await renderer.render(layout, { name: 'Ada' });
    assert.deepEqual(PdfText.pages(viaPool.pdf), PdfText.pages(inProcess.pdf));
    assert.equal(viaPool.pages, 1);
    const many = await Promise.all(Array.from({ length: 6 }, (_, i) => renderer.render(layout, { name: `n${i}` })));
    assert.equal(many.length, 6);
    assert.equal(pool.stats.runs, 7);
  } finally {
    await pool.close();
  }
});

test('pool: layout errors come back as the same RenderError with their details; images travel as bytes', async () => {
  const { renderer, pool } = pooled({ MAX_PAGES: '2' });
  try {
    await assert.rejects(renderer.render({ blocks: [{ type: 'table', rows: 'items', columns: [{ header: 'A', value: '{{n}}' }] }] }, { items: Array.from({ length: 400 }, (_, i) => ({ n: String(i) })) }), (e) => fails('TOO_MANY_PAGES')(e) && /** @type {any} */ (e).details.block === 'blocks[0]');
    const withImage = await renderer.render({ blocks: [{ type: 'image', data: PNG.toString('base64'), width: 40 }] }, {});
    assert.equal(withImage.pages, 1);
  } finally {
    await pool.close();
  }
});

test('pool: a job that outlives its time kills only its worker; the slot gets a fresh one and keeps serving', async () => {
  const { config } = testSystem(media.url, { RENDER_TIMEOUT_MS: '1000' });
  const limits = { ...config.limits, renderTimeoutMs: 100 };
  const pool = new RenderPool({ size: 1, limits, workerUrl: new URL('./hang-worker.js', import.meta.url) }).start();
  try {
    const started = Date.now();
    await assert.rejects(pool.run({ layout: { hang: true }, data: {}, meta: {}, images: new Map() }), fails('RENDER_TIMEOUT'));
    assert.ok(Date.now() - started < 3_000, 'answered at the deadline plus grace, not never');
    const next = await pool.run({ layout: {}, data: {}, meta: {}, images: new Map() });
    assert.deepEqual([next.pages, next.pdf.toString()], [1, '%PDF']);
    assert.deepEqual([pool.stats.killed, pool.stats.runs], [1, 2]);
    await assert.rejects(pool.run({ layout: { crash: true }, data: {}, meta: {}, images: new Map() }), fails('RENDER_FAILED'));
    assert.equal((await pool.run({ layout: {}, data: {}, meta: {}, images: new Map() })).pages, 1, 'a crashed worker is replaced too');
  } finally {
    await pool.close();
  }
});

test('pool: closing fails queued work and stops the threads', async () => {
  const { renderer, pool } = pooled({}, 1);
  await pool.close();
  await assert.rejects(renderer.render({ blocks: [{ type: 'text', text: 'late' }] }, {}), fails('RENDER_FAILED'));
});
