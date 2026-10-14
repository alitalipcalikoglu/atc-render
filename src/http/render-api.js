import { readFileSync } from 'node:fs';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { AuditClient } from '@atc-web/atc-service-core/audit';
import { createErrorHandler, registerInfo, registerOpenApi, registerProbes, registerRequestContext, requestOptions } from '@atc-web/atc-service-core/fastify';
import { RenderError } from '../domain/errors.js';
import { Actor } from './actor.js';
import { ApiKeyAuth } from './api-key-auth.js';
import { Schemas } from './schemas.js';
import { Views } from './views.js';

/** @typedef {import('../config.js').Config} Config */
/** @typedef {import('fastify').FastifyInstance} FastifyInstance */
/** @typedef {import('fastify').FastifyRequest} FastifyRequest */
/** @typedef {import('fastify').FastifyReply} FastifyReply */

/** HTTP surface: templates (write role), rendering (read role), previews of unsaved layouts (write role). */
export class RenderApi {
  static READY_CACHE_MS = 10_000;
  static PDF_CSP = "default-src 'none'; sandbox";

  /**
   * @param {object} deps
   * @param {Config} deps.config
   * @param {import('../domain/render-service.js').RenderService} deps.service
   * @param {import('../store/template-store.js').TemplateStore} deps.templates
   * @param {import('../db.js').Database} deps.db
   * @param {string} deps.version
   * @param {import('../types.js').Logger} [deps.logger]
   * @param {import('@atc-web/atc-service-core/audit').AuditClient} [deps.audit]
   */
  constructor({ config, audit, service, templates, db, version, logger }) {
    this.config = config;
    this.audit = audit;
    this.service = service;
    this.templates = templates;
    this.db = db;
    this.version = version;
    this.logger = logger;
    this.auth = new ApiKeyAuth(config.apiKeys);
  }

  /** @returns {Promise<FastifyInstance>} */
  async build() {
    const { config } = this;
    const app = Fastify({
      ...(config.tls ? { https: { cert: readFileSync(config.tls.certPath), key: readFileSync(config.tls.keyPath), minVersion: 'TLSv1.2' } } : {}),
      ...requestOptions({ logger: this.logger, logLevel: config.logLevel }),
      trustProxy: config.trustProxy,
      bodyLimit: config.bodyLimit,
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
    });
    registerRequestContext(app, { trustProxy: config.trustProxy });
    app.decorateRequest('apiKey', /** @type {any} */ (null));
    app.setErrorHandler(createErrorHandler(RenderError));
    app.addHook('onSend', new Actor(config.actorKeys).auditHook(this.audit));
    app.setNotFoundHandler((_request, reply) => {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } });
    });
    app.addHook('onSend', async (_request, reply) => {
      reply.header('x-content-type-options', 'nosniff');
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    });
    registerProbes(app, () => this.db.ping(), { cacheMs: RenderApi.READY_CACHE_MS });
    registerOpenApi(app, new URL('../../openapi.yaml', import.meta.url));
    registerInfo(app, {
      service: 'atc-render',
      version: this.version,
      capabilities: ['pdf', 'versioned-templates', 'unicode-fonts', 'tables', 'qr', 'images-base64', ...(config.media ? ['images-media', 'store-media'] : [])],
      schemaVersion: this.db.schemaVersion,
    });
    await app.register((api) => this.#registerV1(api), { prefix: '/v1' });
    await app.register((ops) => this.#registerMetrics(ops));
    return app;
  }

  /**
   * @param {FastifyReply} reply
   * @param {{ pdf: Buffer, pages: number, ms: number, filename: string }} r
   */
  static #pdf(reply, r) {
    return reply
      .type('application/pdf')
      .header('content-disposition', `attachment; filename="${r.filename}"`)
      .header('content-security-policy', RenderApi.PDF_CSP)
      .header('content-length', String(r.pdf.length))
      .header('x-render-pages', String(r.pages))
      .header('x-render-ms', String(r.ms))
      .send(r.pdf);
  }

  /** @param {FastifyInstance} api */
  async #registerV1(api) {
    api.addHook('onRequest', this.auth.hook);
    await api.register(rateLimit, {
      max: this.config.rateLimitMax,
      timeWindow: '1 minute',
      keyGenerator: (request) => request.apiKey.id,
      errorResponseBuilder: (_request, context) => Object.assign(new Error(`rate limit exceeded, retry in ${context.after}`), { statusCode: 429, code: 'RATE_LIMITED' }),
    });
    const s = this.service;
    const who = new Actor(this.config.actorKeys);
    const read = { preHandler: ApiKeyAuth.require('read') };
    const write = { preHandler: ApiKeyAuth.require('write') };
    const name = (/** @type {FastifyRequest} */ r) => /** @type {{ name: string }} */ (r.params).name;
    const target = (/** @type {FastifyRequest} */ r) => ({ type: 'template', id: name(r) });

    api.get('/templates', read, async () => ({ items: this.templates.all().map(Views.template) }));

    api.post('/templates', { config: { audit: AuditClient.route('atc-render.template.create', (_r, b) => ({ type: 'template', id: b.template.name }), (_r, b) => ({ version: b.template.latestVersion })) }, ...write, schema: { body: Schemas.create } }, async (request, reply) => {
      const t = s.create(/** @type {any} */ (request.body), who.of(request));
      reply.header('location', `/v1/templates/${t.name}`);
      return reply.code(201).send({ template: Views.template(t) });
    });

    api.get('/templates/:name', { ...read, schema: { params: Schemas.nameParams } }, async (request) => {
      const t = s.template(name(request));
      return { template: Views.template(t), versions: this.templates.versions(t.name).map(Views.version) };
    });

    api.patch('/templates/:name', { config: { audit: AuditClient.route('atc-render.template.update', target) }, ...write, schema: { params: Schemas.nameParams, body: Schemas.patch } }, async (request) => ({ template: Views.template(s.describe(name(request), /** @type {any} */ (request.body))) }));

    api.delete('/templates/:name', { config: { audit: AuditClient.route('atc-render.template.delete', target) }, ...write, schema: { params: Schemas.nameParams } }, async (request, reply) => {
      s.delete(name(request));
      return reply.code(204).send();
    });

    api.post('/templates/:name/versions', { config: { audit: AuditClient.route('atc-render.version.create', target, (_r, b) => ({ version: b.version.version })) }, ...write, schema: { params: Schemas.nameParams, body: Schemas.version } }, async (request, reply) => {
      const v = s.publish(name(request), /** @type {any} */ (request.body), who.of(request));
      return reply.code(201).send({ version: Views.version(v) });
    });

    api.get('/templates/:name/versions/:version', { ...read, schema: { params: Schemas.versionParams } }, async (request) => {
      const p = /** @type {{ name: string, version: string }} */ (request.params);
      return { version: Views.version(s.version(p.name, Number(p.version))) };
    });

    api.post('/render', {
      config: { audit: AuditClient.route('atc-render.document.render', (r) => ({ type: 'template', id: /** @type {any} */ (r.body).template }), (r) => ({ version: /** @type {any} */ (r.body).version ?? 'latest', store: /** @type {any} */ (r.body).store === true })) },
      ...read, schema: { body: Schemas.render },
    }, async (request, reply) => {
      const r = await s.render(/** @type {any} */ (request.body), who.of(request));
      if (!r.stored) return RenderApi.#pdf(reply, r);
      return reply.code(201).send({ fileId: r.stored.fileId, url: r.stored.url, expiresAt: r.stored.expiresAt, pages: r.pages, bytes: r.pdf.length, version: r.version });
    });

    api.post('/render/preview', { config: { audit: AuditClient.route('atc-render.document.preview', () => ({ type: 'layout', id: 'preview' })) }, ...write, schema: { body: Schemas.preview } }, async (request, reply) => RenderApi.#pdf(reply, await s.preview(/** @type {any} */ (request.body), who.of(request))));

    api.get('/stats', read, async () => s.stats());
  }

  /** @param {FastifyInstance} ops */
  #registerMetrics(ops) {
    ops.addHook('onRequest', this.auth.hook);
    ops.get('/metrics', { logLevel: 'warn', preHandler: ApiKeyAuth.require('read') }, async (_request, reply) => {
      const st = this.service.stats();
      const c = this.service.counters;
      const label = (/** @type {string} */ v) => v.replace(/[\\"\n]/g, '\\$&');
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return [
        '# HELP render_templates Templates.',
        '# TYPE render_templates gauge',
        `render_templates ${st.templates}`,
        '# HELP render_renders_24h Renders in the last 24 hours, by outcome.',
        '# TYPE render_renders_24h gauge',
        `render_renders_24h{outcome="succeeded"} ${st.last24h.succeeded}`,
        `render_renders_24h{outcome="failed"} ${st.last24h.failed}`,
        '# HELP render_failures_24h Failed renders in the last 24 hours, by error code.',
        '# TYPE render_failures_24h gauge',
        ...Object.entries(st.last24h.errors).map(([code, n]) => `render_failures_24h{code="${label(code)}"} ${n}`),
        '# HELP render_avg_ms_24h Average duration of successful renders in the last 24 hours.',
        '# TYPE render_avg_ms_24h gauge',
        `render_avg_ms_24h ${st.last24h.avgMs}`,
        '# HELP render_pages_24h Pages rendered in the last 24 hours.',
        '# TYPE render_pages_24h gauge',
        `render_pages_24h ${st.last24h.pages}`,
        '# HELP render_bytes_24h PDF bytes produced in the last 24 hours.',
        '# TYPE render_bytes_24h gauge',
        `render_bytes_24h ${st.last24h.bytes}`,
        '# HELP render_in_flight Renders running now (process-local).',
        '# TYPE render_in_flight gauge',
        `render_in_flight ${st.active}`,
        '# HELP render_busy_total Requests refused because all render slots were busy (process-local).',
        '# TYPE render_busy_total counter',
        `render_busy_total ${c.busy}`,
        '# HELP render_process_uptime_seconds Process uptime.',
        '# TYPE render_process_uptime_seconds gauge',
        `render_process_uptime_seconds ${process.uptime().toFixed(0)}`,
        '',
      ].join('\n');
    });
  }
}
