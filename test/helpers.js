import { createServer } from 'node:http';
import { Config } from '../src/config.js';
import { Database } from '../src/db.js';
import { RenderService } from '../src/domain/render-service.js';
import { MediaClient } from '../src/net/media-client.js';
import { ImageLoader } from '../src/pdf/images.js';
import { QrCode } from '../src/pdf/qr-code.js';
import { Renderer } from '../src/pdf/renderer.js';
import { RenderLog } from '../src/store/render-log.js';
import { TemplateStore } from '../src/store/template-store.js';

export const RW_KEY = 'k'.repeat(40);
export const READ_KEY = 'r'.repeat(40);
export const WRITE_KEY = 'w'.repeat(40);
export const MEDIA_KEY = 'm'.repeat(40);
/** A real PNG (a QR code), 25x25 modules at scale 2. */
export const PNG = new QrCode('atc-render').toPng({ scale: 2 });

/** Fake atc-media: signed URLs, file delivery, private uploads. */
export async function fakeMedia() {
  /** @type {{ files: Map<string, Buffer>, uploads: { name: string, size: number, type: string|undefined }[], seen: string[] }} */
  const state = { files: new Map([['logo', PNG], ['text', Buffer.from('not an image')], ['big', Buffer.alloc(5000, 1)]]), uploads: [], seen: [] };
  const server = createServer((req, res) => {
    state.seen.push(`${req.method} ${req.url}`);
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (/** @type {number} */ s, /** @type {unknown} */ b) => res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify(b));
    const urls = /^\/v1\/files\/([^/]+)\/urls$/.exec(url.pathname);
    // The signed URL names a public host; the client must fetch it through MEDIA_URL anyway.
    if (urls) return state.files.has(urls[1]) || urls[1].startsWith('up') ? json(200, { urls: { original: { url: `https://media.public.example/files/${urls[1]}/original?exp=1&sig=s`, expiresAt: '2030-01-01T00:00:00.000Z' } } }) : json(404, { error: { code: 'NOT_FOUND', message: 'no such file' } });
    const file = /^\/files\/([^/]+)\/original$/.exec(url.pathname);
    if (file && url.searchParams.get('sig') === 's') { const b = state.files.get(file[1]); return b ? res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(b.length) }).end(b) : json(404, {}); }
    if (url.pathname === '/v1/files' && req.method === 'PUT') {
      const chunks = /** @type {Buffer[]} */ ([]);
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { const id = `up${state.uploads.length + 1}`; state.uploads.push({ name: String(url.searchParams.get('name')), size: Buffer.concat(chunks).length, type: req.headers['content-type'] }); json(201, { file: { id, name: url.searchParams.get('name') } }); });
      return;
    }
    json(404, { error: { code: 'NOT_FOUND', message: url.pathname } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  return { state, url, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r(undefined)); }) };
}

/** @param {string} mediaUrl @param {Record<string, string>} [overrides] */
export function testEnv(mediaUrl, overrides = {}) {
  return { PORT: '0', LOG_LEVEL: 'silent', DB_PATH: ':memory:', RENDER_API_KEYS: `console:${RW_KEY},billing:${READ_KEY}:read,designer:${WRITE_KEY}:write`, MEDIA_URL: mediaUrl, MEDIA_API_KEY: MEDIA_KEY, ...overrides };
}

/** @param {string} mediaUrl @param {Record<string, string>} [overrides] @param {{ now?: () => number }} [o] */
export function testSystem(mediaUrl, overrides, { now = Date.now } = {}) {
  const config = Config.fromEnv(testEnv(mediaUrl, overrides));
  const db = new Database(':memory:');
  const templates = new TemplateStore(db);
  const log = new RenderLog(db);
  const media = config.media ? new MediaClient({ upstream: config.media, timeoutMs: config.limits.mediaTimeoutMs }) : null;
  const renderer = new Renderer({ images: new ImageLoader({ media, limits: config.limits }), limits: config.limits, compress: false, now });
  const service = new RenderService({ db, templates, log, renderer, media, limits: config.limits, now });
  return { config, db, templates, log, media, renderer, service };
}

/** @param {string} mediaUrl @param {Record<string, string>} [overrides] @param {object} [deps] */
export async function buildApp(mediaUrl, overrides, deps = {}) {
  const { readServiceVersion } = await import('@atc-web/atc-service-core/fastify');
  const { RenderApi } = await import('../src/http/render-api.js');
  const t = testSystem(mediaUrl, overrides);
  const app = await new RenderApi({ ...t, version: readServiceVersion(import.meta.url), ...deps }).build();
  await app.ready();
  return { app, ...t };
}

/** @param {string} key */
export function bearer(key) {
  return { authorization: `Bearer ${key}` };
}
