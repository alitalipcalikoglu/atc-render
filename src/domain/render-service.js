import { RenderError } from './errors.js';

/** @typedef {import('../types.js').Layout} Layout */

/**
 * Templates (create, describe, publish versions, delete) and rendering (stored template or an
 * unsaved preview), with the data-size cap and bounded concurrency in front of the renderer.
 */
export class RenderService {
  static NAME = /^[a-z][a-z0-9-]{0,63}$/;

  /**
   * @param {object} deps
   * @param {import('../db.js').Database} deps.db
   * @param {import('../store/template-store.js').TemplateStore} deps.templates
   * @param {import('../store/render-log.js').RenderLog} deps.log
   * @param {import('../pdf/renderer.js').Renderer} deps.renderer
   * @param {import('../net/media-client.js').MediaClient|null} deps.media
   * @param {import('../types.js').Limits} deps.limits
   * @param {() => number} [deps.now]
   */
  constructor({ db, templates, log, renderer, media, limits, now = Date.now }) {
    this.db = db;
    this.templates = templates;
    this.log = log;
    this.renderer = renderer;
    this.media = media;
    this.limits = limits;
    this.now = now;
    this.active = 0;
    this.counters = { renders: 0, failed: 0, busy: 0, pages: 0 };
  }

  /** @param {string} name */
  template(name) {
    const t = this.templates.get(name);
    if (!t) throw new RenderError('TEMPLATE_NOT_FOUND', `template "${name}" does not exist`);
    return t;
  }

  /** @param {unknown} layout */
  #layoutJson(layout) {
    const json = JSON.stringify(layout);
    if (Buffer.byteLength(json) > this.limits.maxLayoutBytes) throw new RenderError('LAYOUT_TOO_LARGE', `layout exceeds MAX_LAYOUT_BYTES (${this.limits.maxLayoutBytes})`);
    return json;
  }

  /** @param {{ name: string, description?: string, layout: Layout, note?: string }} input @param {string} actor */
  create(input, actor) {
    if (!RenderService.NAME.test(input.name)) throw new RenderError('INVALID_LAYOUT', 'template name must match [a-z][a-z0-9-]{0,63}');
    const json = this.#layoutJson(input.layout);
    return this.db.transaction(() => {
      if (this.templates.get(input.name)) throw new RenderError('TEMPLATE_EXISTS', `template "${input.name}" already exists`);
      const now = this.now();
      this.templates.insert(input.name, input.description ?? '', actor, now);
      this.templates.addVersion(input.name, json, input.note ?? '', actor, now, this.limits.maxVersions);
      return this.template(input.name);
    });
  }

  /** @param {string} name @param {{ layout: Layout, note?: string }} input @param {string} actor */
  publish(name, input, actor) {
    const json = this.#layoutJson(input.layout);
    return this.db.transaction(() => {
      this.template(name);
      const version = this.templates.addVersion(name, json, input.note ?? '', actor, this.now(), this.limits.maxVersions);
      return /** @type {import('../types.js').VersionRow} */ (this.templates.version(name, version));
    });
  }

  /** @param {string} name @param {{ description: string }} patch */
  describe(name, patch) {
    this.template(name);
    this.templates.describe(name, patch.description, this.now());
    return this.template(name);
  }

  /** @param {string} name */
  delete(name) {
    this.template(name);
    this.templates.delete(name);
  }

  /** @param {string} name @param {number} [version] Latest when omitted. */
  version(name, version) {
    const t = this.template(name);
    const v = this.templates.version(name, version ?? t.latest_version);
    if (!v) throw new RenderError('VERSION_NOT_FOUND', `template "${name}" has no version ${version}`);
    return v;
  }

  /**
   * Render a stored template; `store` writes a private media file instead of returning bytes.
   * @param {{ template: string, version?: number, data?: unknown, filename?: string, store?: boolean }} input
   * @param {string} actor
   */
  async render(input, actor) {
    const v = this.version(input.template, input.version);
    if (input.store && !this.media) throw new RenderError('MEDIA_DISABLED', 'store: true needs MEDIA_URL and MEDIA_API_KEY');
    const result = await this.#run(JSON.parse(v.layout), input.data ?? {}, { template: v.name, version: v.version, title: input.filename ?? v.name, store: Boolean(input.store), actor });
    const filename = RenderService.filename(input.filename ?? `${v.name}-v${v.version}`);
    if (!input.store) return { ...result, filename, version: v.version, stored: null };
    const stored = await /** @type {import('../net/media-client.js').MediaClient} */ (this.media).store(result.pdf, filename, this.limits.downloadTtlSec);
    return { ...result, filename, version: v.version, stored };
  }

  /** Unsaved layout (already schema-validated by the route). @param {{ layout: Layout, data?: unknown }} input @param {string} actor */
  async preview(input, actor) {
    this.#layoutJson(input.layout);
    const result = await this.#run(input.layout, input.data ?? {}, { template: null, version: null, title: 'preview', store: false, actor });
    return { ...result, filename: 'preview.pdf' };
  }

  /**
   * @param {Layout} layout @param {unknown} data
   * @param {{ template: string|null, version: number|null, title: string, store: boolean, actor: string }} meta
   */
  async #run(layout, data, meta) {
    if (Buffer.byteLength(JSON.stringify(data)) > this.limits.maxDataBytes) {
      this.counters.failed++;
      this.log.record({ template: meta.template, version: meta.version, ok: false, errorCode: 'DATA_TOO_LARGE', ms: 0, actor: meta.actor }, this.now());
      throw new RenderError('DATA_TOO_LARGE', `data exceeds MAX_DATA_BYTES (${this.limits.maxDataBytes})`);
    }
    // Refused for capacity, not failed: counted in render_busy_total, not in the render log.
    if (this.active >= this.limits.concurrency) { this.counters.busy++; throw new RenderError('BUSY', `all ${this.limits.concurrency} render slots are busy; retry shortly`); }
    this.active++;
    const started = performance.now();
    try {
      const { pdf, pages } = await this.renderer.render(layout, data, { title: meta.title });
      const ms = performance.now() - started;
      this.log.record({ template: meta.template, version: meta.version, ok: true, ms, pages, bytes: pdf.length, stored: meta.store, actor: meta.actor }, this.now());
      this.counters.renders++;
      this.counters.pages += pages;
      return { pdf, pages, ms: Math.round(ms) };
    } catch (err) {
      this.counters.failed++;
      this.log.record({ template: meta.template, version: meta.version, ok: false, errorCode: err instanceof RenderError ? err.code : 'INTERNAL_ERROR', ms: performance.now() - started, actor: meta.actor }, this.now());
      throw err;
    } finally {
      this.active--;
    }
  }

  /** A safe `.pdf` file name. @param {string} raw */
  static filename(raw) {
    const base = raw.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100);
    return `${base || 'document'}.pdf`;
  }

  stats() {
    const since = this.now() - 86_400_000;
    return { templates: this.templates.count(), last24h: this.log.summary(since), active: this.active, concurrency: this.limits.concurrency };
  }

  /** Drop render-log rows past retention. */
  purge() {
    return this.log.purge(this.now() - this.limits.logRetentionDays * 86_400_000);
  }
}
