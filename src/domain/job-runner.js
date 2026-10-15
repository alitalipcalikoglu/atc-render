import { randomUUID } from 'node:crypto';
import { RenderError } from './errors.js';

/** @typedef {import('../store/job-store.js').JobRow} JobRow */

/**
 * Asynchronous renders: `submit` pins the template version and queues the job; a small in-process
 * pump draws queued jobs through the same {@link RenderService#render} as the synchronous route,
 * at most `jobConcurrency` at a time, so background work never takes every render slot. Jobs left
 * running by a crash are queued again at start. Finished jobs are purged after `jobRetentionMs`.
 */
export class JobRunner {
  static RETRY_BUSY_MS = 1_000;

  /**
   * @param {object} deps
   * @param {import('../store/job-store.js').JobStore} deps.jobs
   * @param {import('./render-service.js').RenderService} deps.service
   * @param {{ jobConcurrency: number, queueMax: number, jobRetentionMs: number, maxDataBytes: number }} deps.options
   * @param {{ error: (obj: object, msg: string) => void }} deps.log
   * @param {() => number} [deps.now]
   */
  constructor({ jobs, service, options, log, now = Date.now }) {
    this.jobs = jobs;
    this.service = service;
    this.options = options;
    this.log = log;
    this.now = now;
    this.running = 0;
    this.stopped = true;
    /** @type {Set<Promise<void>>} */
    this.inFlight = new Set();
    /** @type {NodeJS.Timeout|null} */
    this.retry = null;
  }

  start() {
    this.stopped = false;
    this.jobs.recover();
    this.pump();
    return this;
  }

  /** Stop taking jobs and wait for the running ones (they finish or fail within RENDER_TIMEOUT_MS). */
  async stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    await Promise.allSettled([...this.inFlight]);
  }

  /**
   * Queue a render of a stored template.
   * @param {{ template: string, version?: number, data?: unknown, filename?: string, store?: boolean }} input
   * @param {string} owner  API key id.
   * @param {string} actor
   * @returns {JobRow}
   */
  submit(input, owner, actor) {
    const v = this.service.version(input.template, input.version);
    if (input.store && !this.service.media) throw new RenderError('MEDIA_DISABLED', 'store: true needs MEDIA_URL and MEDIA_API_KEY');
    const data = JSON.stringify(input.data ?? {});
    if (Buffer.byteLength(data) > this.options.maxDataBytes) throw new RenderError('DATA_TOO_LARGE', `data exceeds MAX_DATA_BYTES (${this.options.maxDataBytes})`);
    if (this.jobs.pending() >= this.options.queueMax) throw new RenderError('QUEUE_FULL', `${this.options.queueMax} jobs are already waiting (RENDER_QUEUE_MAX); retry later`);
    const id = randomUUID();
    this.jobs.insert({ id, owner, actor, template: v.name, version: v.version, data, filename: input.filename ?? `${v.name}-v${v.version}`, store: Boolean(input.store) }, this.now());
    this.pump();
    return /** @type {JobRow} */ (this.jobs.get(id));
  }

  /** @param {string} id @param {string} owner @returns {JobRow} */
  get(id, owner) {
    const j = this.jobs.get(id);
    if (!j || j.owner !== owner) throw new RenderError('JOB_NOT_FOUND', 'render job not found');
    return j;
  }

  /** @param {string} id @param {string} owner */
  pdf(id, owner) {
    const j = this.get(id, owner);
    if (j.status !== 'succeeded') throw new RenderError('JOB_NOT_READY', `the job is ${j.status}`, { status: j.status });
    const pdf = this.jobs.pdf(id);
    if (!pdf) throw new RenderError('JOB_NOT_READY', 'the job stored its PDF in media; use fileId', { fileId: j.file_id });
    return { pdf, filename: j.filename, pages: Number(j.pages) };
  }

  /** Start queued jobs while there is room. */
  pump() {
    while (!this.stopped && this.running < this.options.jobConcurrency) {
      const job = this.jobs.claimNext(this.now());
      if (!job) return;
      this.running++;
      const p = this.#run(job).then((busy) => {
        this.running--;
        this.inFlight.delete(p);
        // BUSY: every render slot is held by synchronous requests; try again shortly, not in a loop.
        if (!busy) this.pump();
        else if (!this.retry && !this.stopped) this.retry = setTimeout(() => { this.retry = null; this.pump(); }, JobRunner.RETRY_BUSY_MS).unref();
      });
      this.inFlight.add(p);
    }
  }

  /** @param {JobRow} job @returns {Promise<boolean>} true when the job went back to the queue because no render slot was free. */
  async #run(job) {
    try {
      const r = await this.service.render({ template: job.template, version: job.version, data: JSON.parse(job.data), filename: job.filename, store: job.store === 1 }, job.actor);
      this.jobs.succeed(job.id, {
        pages: r.pages, bytes: r.pdf.length, pdf: r.stored ? null : r.pdf,
        fileId: r.stored?.fileId ?? null, url: r.stored?.url ?? null, urlExpiresAt: r.stored?.expiresAt ? Date.parse(r.stored.expiresAt) : null,
      }, this.now());
    } catch (err) {
      if (err instanceof RenderError && err.code === 'BUSY') {
        this.jobs.requeue(job.id);
        return true;
      }
      if (!(err instanceof RenderError)) this.log.error({ err, jobId: job.id }, 'render job failed');
      this.jobs.fail(job.id, err instanceof RenderError ? err.code : 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err), this.now());
    }
    return false;
  }

  /** Drop finished jobs past retention. */
  purge() {
    return this.jobs.purge(this.now() - this.options.jobRetentionMs);
  }
}
