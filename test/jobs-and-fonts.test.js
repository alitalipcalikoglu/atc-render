import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Config } from '../src/config.js';
import { JobRunner } from '../src/domain/job-runner.js';
import { FontCatalog } from '../src/pdf/font-catalog.js';
import { Renderer } from '../src/pdf/renderer.js';
import { JobStore } from '../src/store/job-store.js';
import { READ_KEY, RW_KEY, bearer, buildApp, fakeMedia, testEnv } from './helpers.js';

/** @type {Awaited<ReturnType<typeof fakeMedia>>} */ let media;
const fontsDir = mkdtempSync(join(tmpdir(), 'render-fonts-'));
before(async () => {
  media = await fakeMedia();
  copyFileSync(join(Renderer.FONTS_DIR, 'DejaVuSansMono.ttf'), join(fontsDir, 'Testface-Regular.ttf'));
  copyFileSync(join(Renderer.FONTS_DIR, 'DejaVuSans-Bold.ttf'), join(fontsDir, 'Testface-Bold.ttf'));
  writeFileSync(join(fontsDir, 'README.txt'), 'ignored');
});
after(async () => { await media.close(); rmSync(fontsDir, { recursive: true, force: true }); });

const layout = { blocks: [{ type: 'heading', text: 'Fatura {{no}}' }, { type: 'text', text: 'Şükran çiçek' }] };

/** App with a running job runner. @param {Record<string, string>} [env] @param {{ fonts?: any }} [o] */
async function system(env = {}, o = {}) {
  const t = await buildApp(media.url, env);
  if (o.fonts) t.renderer.fonts = o.fonts;
  const jobs = new JobRunner({ jobs: new JobStore(t.db), service: t.service, log: { error: () => {} }, options: { jobConcurrency: t.config.limits.jobConcurrency, queueMax: t.config.limits.queueMax, jobRetentionMs: 3_600_000, maxDataBytes: t.config.limits.maxDataBytes } });
  await t.app.close();
  const { RenderApi } = await import('../src/http/render-api.js');
  const app = await new RenderApi({ ...t, jobs, version: '0.0.0' }).build();
  await app.ready();
  return { ...t, app, jobs: jobs.start() };
}

/** @param {JobRunner} jobs */
const settle = async (jobs) => { for (let i = 0; i < 200 && (jobs.running || jobs.jobs.pending()); i++) await new Promise((r) => setTimeout(r, 10)); };

test('config: job limits and FONTS_DIR', () => {
  const c = Config.fromEnv(testEnv(media.url));
  assert.equal(c.limits.jobConcurrency, 1);
  assert.equal(c.limits.queueMax, 100);
  assert.equal(c.fontsDir, null);
  assert.throws(() => Config.fromEnv(testEnv(media.url, { RENDER_CONCURRENCY: '2', RENDER_JOB_CONCURRENCY: '3' })), /must not exceed/);
});

test('FontCatalog: families, fallbacks, reserved names, broken files', () => {
  const fonts = FontCatalog.scan(fontsDir);
  assert.deepEqual(Object.keys(fonts), ['testface']);
  assert.match(fonts.testface.bold, /Testface-Bold\.ttf$/);
  assert.equal(fonts.testface.italic, fonts.testface.regular, 'missing italic falls back to regular');
  const bad = mkdtempSync(join(tmpdir(), 'render-fonts-bad-'));
  try {
    writeFileSync(join(bad, 'Broken.ttf'), 'not a font');
    assert.throws(() => FontCatalog.scan(bad), /not a usable font/);
    rmSync(join(bad, 'Broken.ttf'));
    writeFileSync(join(bad, 'Only-Bold.ttf'), 'x');
    assert.throws(() => FontCatalog.scan(bad), /no regular face/);
    rmSync(join(bad, 'Only-Bold.ttf'));
    copyFileSync(join(Renderer.FONTS_DIR, 'DejaVuSans.ttf'), join(bad, 'Sans.ttf'));
    assert.throws(() => FontCatalog.scan(bad), /reserved/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
  assert.throws(() => FontCatalog.scan(join(fontsDir, 'missing')), /cannot be read/);
  assert.deepEqual(FontCatalog.scan(null), {});
});

test('page.font selects a FONTS_DIR family; unknown fonts are refused at save and preview', async () => {
  const { app } = await system({}, { fonts: FontCatalog.scan(fontsDir) });
  assert.deepEqual((await app.inject({ url: '/v1/fonts', headers: bearer(READ_KEY) })).json(), { default: 'dejavu', items: ['testface'], nextCursor: null });
  const res = await app.inject({ method: 'POST', url: '/v1/render/preview', headers: bearer(RW_KEY), payload: { layout: { ...layout, page: { font: 'testface' } }, data: { no: 1 } } });
  assert.equal(res.statusCode, 200, res.body);
  const pdf = res.rawPayload.toString('latin1');
  assert.match(pdf, /DejaVuSansMono/, 'the family replaced the sans faces');
  assert.match(pdf, /DejaVuSans-Bold/, 'headings use the family bold face');
  const unknown = await app.inject({ method: 'POST', url: '/v1/templates', headers: bearer(RW_KEY), payload: { name: 'f', layout: { ...layout, page: { font: 'nope' } } } });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().error.code, 'UNKNOWN_FONT');
  assert.ok((await app.inject({ url: '/v1/info' })).json().capabilities.includes('custom-fonts'));
  await app.close();
});

test('async renders: queued, drawn in the background, owner-scoped, PDF downloadable', async () => {
  const { app, jobs } = await system();
  await app.inject({ method: 'POST', url: '/v1/templates', headers: bearer(RW_KEY), payload: { name: 'invoice', layout } });
  const res = await app.inject({ method: 'POST', url: '/v1/renders', headers: bearer(RW_KEY), payload: { template: 'invoice', data: { no: 7 }, filename: 'inv 7' } });
  assert.equal(res.statusCode, 202, res.body);
  const job = res.json().job;
  assert.equal(res.headers.location, `/v1/renders/${job.id}`);
  assert.equal(job.version, 1, 'version pinned at submit');
  assert.ok(['queued', 'running'].includes(job.status));
  // A version published after submit does not change the job.
  await app.inject({ method: 'POST', url: '/v1/templates/invoice/versions', headers: bearer(RW_KEY), payload: { layout: { blocks: [{ type: 'text', text: 'v2' }] } } });
  await settle(jobs);
  const done = (await app.inject({ url: `/v1/renders/${job.id}`, headers: bearer(RW_KEY) })).json().job;
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.equal(done.version, 1);
  assert.deepEqual(done.result, { download: `/v1/renders/${job.id}/pdf` });
  assert.ok(done.pages >= 1);
  const pdf = await app.inject({ url: `/v1/renders/${job.id}/pdf`, headers: bearer(RW_KEY) });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.match(String(pdf.headers['content-disposition']), /inv-7\.pdf/);
  assert.equal((await app.inject({ url: `/v1/renders/${job.id}`, headers: bearer(READ_KEY) })).statusCode, 404, 'another key cannot see it');
  const list = (await app.inject({ url: '/v1/renders?status=succeeded', headers: bearer(RW_KEY) })).json().items;
  assert.equal(list.length, 1);
  const idem = { ...bearer(RW_KEY), 'idempotency-key': 'render-inv-8' };
  const second = (await app.inject({ method: 'POST', url: '/v1/renders', headers: idem, payload: { template: 'invoice', data: { no: 8 } } })).json().job;
  const replay = await app.inject({ method: 'POST', url: '/v1/renders', headers: idem, payload: { template: 'invoice', data: { no: 8 } } });
  assert.deepEqual([replay.statusCode, replay.headers['idempotent-replayed'], replay.json().job.id], [202, 'true', second.id], 'a repeated submit replays instead of queueing again');
  await settle(jobs);
  const p1 = (await app.inject({ url: '/v1/renders?limit=1', headers: bearer(RW_KEY) })).json();
  assert.deepEqual([p1.items[0].id, p1.nextCursor], [second.id, second.id]);
  const p2 = (await app.inject({ url: `/v1/renders?limit=1&cursor=${p1.nextCursor}`, headers: bearer(RW_KEY) })).json();
  assert.deepEqual([p2.items.map((/** @type {any} */ j) => j.id), p2.nextCursor], [[job.id], null], 'newest first, last page has no cursor');
  assert.equal((await app.inject({ url: '/v1/stats', headers: bearer(RW_KEY) })).json().jobs.succeeded, 2);
  assert.match((await app.inject({ url: '/metrics', headers: bearer(RW_KEY) })).body, /render_jobs\{status="succeeded"\} 2/);
  await jobs.stop();
  await app.close();
});

test('async renders: failures, store in media, queue limit, not-ready, unknown template', async () => {
  const { app, jobs, config } = await system({ RENDER_QUEUE_MAX: '2', MAX_TABLE_ROWS: '1' });
  await app.inject({ method: 'POST', url: '/v1/templates', headers: bearer(RW_KEY), payload: { name: 'inv', layout: { blocks: [{ type: 'table', columns: [{ header: 'A', value: '{{a}}' }], rows: 'rows' }] } } });
  assert.equal((await app.inject({ method: 'POST', url: '/v1/renders', headers: bearer(RW_KEY), payload: { template: 'missing' } })).json().error.code, 'TEMPLATE_NOT_FOUND');
  jobs.stopped = true; // hold the queue to test the limit
  const a = (await app.inject({ method: 'POST', url: '/v1/renders', headers: bearer(RW_KEY), payload: { template: 'inv', data: { rows: [{ a: 1 }] }, store: true } })).json().job;
  const b = (await app.inject({ method: 'POST', url: '/v1/renders', headers: bearer(RW_KEY), payload: { template: 'inv', data: { rows: [{ a: 1 }, { a: 2 }] } } })).json().job;
  const full = await app.inject({ method: 'POST', url: '/v1/renders', headers: bearer(RW_KEY), payload: { template: 'inv' } });
  assert.equal(full.statusCode, 429);
  assert.equal(full.json().error.code, 'QUEUE_FULL');
  const early = await app.inject({ url: `/v1/renders/${a.id}/pdf`, headers: bearer(RW_KEY) });
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().error.code, 'JOB_NOT_READY');
  jobs.stopped = false;
  jobs.pump();
  await settle(jobs);
  const sa = (await app.inject({ url: `/v1/renders/${a.id}`, headers: bearer(RW_KEY) })).json().job;
  assert.equal(sa.status, 'succeeded', JSON.stringify(sa));
  assert.match(sa.result.fileId, /^up/);
  assert.match(sa.result.url, /^https:\/\/media\.public\.example\//);
  assert.equal((await app.inject({ url: `/v1/renders/${a.id}/pdf`, headers: bearer(RW_KEY) })).json().error.code, 'JOB_NOT_READY');
  const sb = (await app.inject({ url: `/v1/renders/${b.id}`, headers: bearer(RW_KEY) })).json().job;
  assert.equal(sb.status, 'failed');
  assert.ok(sb.error.code, JSON.stringify(sb));
  assert.notEqual(sb.error.code, 'INTERNAL_ERROR');
  assert.equal(config.limits.queueMax, 2);
  await jobs.stop();
  await app.close();
});

test('JobRunner: crash recovery requeues running jobs; BUSY requeues instead of failing; purge', async () => {
  const { app, jobs, service, db } = await system();
  await app.inject({ method: 'POST', url: '/v1/templates', headers: bearer(RW_KEY), payload: { name: 'r', layout } });
  await jobs.stop();
  const store = jobs.jobs;
  const j = jobs.submit({ template: 'r' }, 'console', 'console');
  store.claimNext(Date.now());
  assert.equal(store.get(j.id)?.status, 'running');
  assert.equal(store.recover(), 1);
  assert.equal(store.get(j.id)?.status, 'queued');
  service.active = service.limits.concurrency; // every slot taken by synchronous renders
  jobs.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.get(j.id)?.status, 'queued', 'BUSY puts the job back');
  service.active = 0;
  await settle(jobs);
  await new Promise((r) => setTimeout(r, 1_200));
  await settle(jobs);
  assert.equal(store.get(j.id)?.status, 'succeeded');
  jobs.now = () => Date.now() + 2 * 3_600_000;
  assert.equal(jobs.purge(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()?.n, 0);
  await jobs.stop();
  await app.close();
});
