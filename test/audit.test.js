import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AuditClient } from '@atc-web/atc-service-core/audit';
import { READ_KEY, RW_KEY, bearer, buildApp, fakeMedia } from './helpers.js';

const silent = { warn() {}, error() {} };
/** @type {Awaited<ReturnType<typeof fakeMedia>>} */ let media;
before(async () => { media = await fakeMedia(); });
after(() => media.close());

test('API: template writes, versions, renders and previews are audit events; denials too; reads are not', async (t) => {
  const audit = new AuditClient({ target: { url: 'http://audit.test', apiKey: 'a'.repeat(40) }, logger: silent, fetch: async () => new Response('{}', { status: 200 }) });
  const { app } = await buildApp(media.url, undefined, { audit });
  t.after(() => app.close());
  const h = { ...bearer(RW_KEY), 'user-agent': 'test-agent' };
  const layout = { blocks: [{ type: 'text', text: 'x' }] };
  await app.inject({ method: 'POST', url: '/v1/templates', headers: h, payload: { name: 'cert', layout } });
  await app.inject({ method: 'PATCH', url: '/v1/templates/cert', headers: h, payload: { description: 'Certificates' } });
  await app.inject({ method: 'POST', url: '/v1/templates/cert/versions', headers: h, payload: { layout } });
  await app.inject({ method: 'POST', url: '/v1/render', headers: h, payload: { template: 'cert', store: true } });
  await app.inject({ method: 'POST', url: '/v1/render/preview', headers: h, payload: { layout } });
  await app.inject({ method: 'DELETE', url: '/v1/templates/cert', headers: h });
  assert.deepEqual(audit.buffer.map((e) => e.action), ['atc-render.template.create', 'atc-render.template.update', 'atc-render.version.create', 'atc-render.document.render', 'atc-render.document.preview', 'atc-render.template.delete']);
  const [create, , version, render] = audit.buffer;
  assert.deepEqual([create.outcome, create.actor, create.target, create.meta], ['success', { type: 'apikey', id: 'console' }, { type: 'template', id: 'cert' }, { version: 1 }]);
  assert.deepEqual([version.meta, render.meta], [{ version: 2 }, { version: 'latest', store: true }]);
  const n = audit.buffer.length;
  assert.equal((await app.inject({ method: 'POST', url: '/v1/templates', headers: bearer(READ_KEY), payload: { name: 'x', layout } })).statusCode, 403);
  assert.deepEqual([audit.buffer.length, audit.buffer.at(-1)?.outcome], [n + 1, 'denied']);
  await app.inject({ url: '/v1/templates', headers: h });
  assert.equal(audit.buffer.length, n + 1);
});
