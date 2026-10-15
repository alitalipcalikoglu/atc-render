import { Config } from './config.js';
import { AuditClient } from '@atc-web/atc-service-core/audit';
import { Lifecycle } from '@atc-web/atc-service-core/lifecycle';
import { readServiceVersion } from '@atc-web/atc-service-core/fastify';
import { Database } from './db.js';
import { JobRunner } from './domain/job-runner.js';
import { RenderService } from './domain/render-service.js';
import { FontCatalog } from './pdf/font-catalog.js';
import { JobStore } from './store/job-store.js';
import { RenderApi } from './http/render-api.js';
import { MediaClient } from './net/media-client.js';
import { ImageLoader } from './pdf/images.js';
import { RenderPool } from './pdf/render-pool.js';
import { Renderer } from './pdf/renderer.js';
import { RenderLog } from './store/render-log.js';
import { TemplateStore } from './store/template-store.js';

/** Composition root: wires configuration, storage, renderer and HTTP, and owns the process lifecycle. */
export class Application {
  static PURGE_INTERVAL_MS = 3_600_000;

  /** @param {Config} config */
  constructor(config) {
    this.config = config;
    this.version = readServiceVersion(import.meta.url);
    this.audit = new AuditClient({ target: config.audit });
    this.db = new Database(config.dbPath, { backupDir: config.dbBackupDir });
    this.templates = new TemplateStore(this.db);
    this.log = new RenderLog(this.db);
    this.media = config.media ? new MediaClient({ upstream: config.media, timeoutMs: config.limits.mediaTimeoutMs }) : null;
    // Drawing runs in worker threads (RENDER_WORKERS; 0 = in this thread): a heavy document never stalls the HTTP loop.
    const fonts = FontCatalog.scan(config.fontsDir);
    this.pool = config.limits.workers > 0 ? new RenderPool({ size: config.limits.workers, limits: config.limits, fonts }).start() : null;
    this.renderer = new Renderer({ images: new ImageLoader({ media: this.media, limits: config.limits }), limits: config.limits, pool: this.pool, fonts });
    this.service = new RenderService({ db: this.db, templates: this.templates, log: this.log, renderer: this.renderer, media: this.media, limits: config.limits });
    this.jobs = new JobRunner({
      jobs: new JobStore(this.db), service: this.service, log: /** @type {any} */ (console),
      options: { jobConcurrency: config.limits.jobConcurrency, queueMax: config.limits.queueMax, jobRetentionMs: config.limits.jobRetentionHours * 3_600_000, maxDataBytes: config.limits.maxDataBytes },
    });
    /** @type {import('fastify').FastifyInstance|null} */
    this.app = null;
    /** @type {NodeJS.Timeout|null} */
    this.timer = null;
    /** @type {(reason: string) => Promise<void>} */
    this.shutdown = async () => {};
  }

  /** Build from `process.env`; exits with a readable message on bad configuration. */
  static fromEnv() {
    try {
      return new Application(Config.fromEnv());
    } catch (err) {
      if (err instanceof Error && err.name === 'ConfigError') {
        console.error(`configuration error: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  }

  async start() {
    const { config } = this;
    const app = await new RenderApi({ config, audit: this.audit, service: this.service, jobs: this.jobs, pool: this.pool, templates: this.templates, db: this.db, version: this.version }).build();
    this.app = app;
    this.jobs.log = app.log.child({ component: 'jobs' });
    const purge = () => {
      try {
        const n = this.service.purge();
        const jobs = this.jobs.purge();
        if (n || jobs) app.log.info({ purged: n, jobs }, 'render log and job retention');
      } catch (err) { app.log.error({ err }, 'render log retention failed'); }
    };
    purge();
    this.timer = setInterval(purge, Application.PURGE_INTERVAL_MS);
    this.timer.unref();
    const { shutdown } = Lifecycle.install({
      forceExitMs: 30_000,
      log: app.log,
      steps: [
        () => { if (this.timer) clearInterval(this.timer); },
        () => this.app?.close(),
        () => this.jobs.stop(),
        () => this.pool?.close(),
        () => this.audit.close(),
        () => this.db.close(),
      ],
    });
    this.shutdown = shutdown;
    this.audit.logger = app.log;
    this.audit.start();
    await app.listen({ port: config.port, host: config.host });
    app.log.info({ tls: config.tls !== null, media: config.media !== null, concurrency: config.limits.concurrency }, config.tls ? 'serving HTTPS' : 'serving plain HTTP, terminate TLS at a reverse proxy');
    this.jobs.start();
    if (process.send) process.send('ready'); // PM2 wait_ready
  }
}
