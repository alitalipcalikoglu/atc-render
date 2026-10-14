import { Worker } from 'node:worker_threads';
import { RenderError } from '../domain/errors.js';

/**
 * A fixed set of worker threads that draw PDFs, so a heavy document blocks one worker, never the
 * HTTP event loop (health, other requests). Jobs beyond the number of workers wait in a queue (the
 * service's concurrency limit bounds how many exist). When a job outlives its time the worker is killed
 * and replaced, which also stops a single huge block that no cooperative check could interrupt.
 */
export class RenderPool {
  static GRACE_MS = 1_000;

  /** @param {{ size: number, limits: import('../types.js').Limits, compress?: boolean, workerUrl?: URL }} o  `workerUrl` is for tests. */
  constructor({ size, limits, compress = true, workerUrl = new URL('./render-worker.js', import.meta.url) }) {
    this.size = size;
    this.limits = limits;
    this.compress = compress;
    this.url = workerUrl;
    /** @type {{ worker: Worker, job: { id: number, resolve: Function, reject: Function, timer: NodeJS.Timeout }|null }[]} */
    this.slots = [];
    /** @type {{ payload: any, resolve: Function, reject: Function }[]} */
    this.queue = [];
    this.nextId = 1;
    this.closed = false;
    this.stats = { runs: 0, killed: 0, crashed: 0 };
  }

  /** Start the threads. */
  start() {
    for (let i = 0; i < this.size; i += 1) {
      const slot = { worker: /** @type {Worker} */ (/** @type {unknown} */ (null)), job: /** @type {any} */ (null) };
      this.#attach(slot);
      this.slots.push(slot);
    }
    return this;
  }

  /** Give a slot a fresh worker. @param {{ worker: Worker, job: any }} slot */
  #attach(slot) {
    const w = new Worker(this.url, { workerData: { limits: this.limits, compress: this.compress } });
    slot.worker = w;
    w.on('message', (msg) => { if (slot.worker === w) this.#done(slot, msg); });
    w.on('error', (err) => { if (slot.worker === w) this.#died(slot, err); });
    w.on('exit', (code) => { if (!this.closed && slot.worker === w) this.#died(slot, new Error(`render worker exited with code ${code}`)); });
    w.unref();
  }

  /**
   * @param {{ layout: any, data: unknown, meta: { title?: string }, images: Map<string, Buffer> }} payload
   * @returns {Promise<{ pdf: Buffer, pages: number }>}
   */
  run(payload) {
    if (this.closed) return Promise.reject(new RenderError('RENDER_FAILED', 'the render pool is closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      this.#pump();
    });
  }

  #pump() {
    for (const slot of this.slots) {
      if (slot.job || this.queue.length === 0) continue;
      const next = /** @type {NonNullable<(typeof this.queue)[number]>} */ (this.queue.shift());
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.stats.killed += 1;
        this.#replace(slot);
        next.reject(new RenderError('RENDER_TIMEOUT', `render exceeded RENDER_TIMEOUT_MS (${this.limits.renderTimeoutMs})`));
      }, this.limits.renderTimeoutMs + RenderPool.GRACE_MS);
      timer.unref();
      slot.job = { id, resolve: next.resolve, reject: next.reject, timer };
      this.stats.runs += 1;
      slot.worker.postMessage({ id, layout: next.payload.layout, data: next.payload.data, meta: next.payload.meta, images: [...next.payload.images].map(([p, b]) => [p, new Uint8Array(b)]) });
    }
  }

  /** @param {{ worker: Worker, job: any }} slot @param {any} msg */
  #done(slot, msg) {
    const job = slot.job;
    if (!job || job.id !== msg.id) return;
    clearTimeout(job.timer);
    slot.job = null;
    if (msg.ok) job.resolve({ pdf: Buffer.from(msg.pdf), pages: msg.pages });
    else job.reject(new RenderError(msg.code, msg.message, msg.details));
    this.#pump();
  }

  /** @param {{ worker: Worker, job: any }} slot @param {Error} err */
  #died(slot, err) {
    const job = slot.job;
    this.#replace(slot);
    if (!job) return;
    clearTimeout(job.timer);
    this.stats.crashed += 1;
    job.reject(new RenderError('RENDER_FAILED', `render worker failed: ${err.message}`));
  }

  /** Replace a killed or crashed worker by a fresh one in the same slot. @param {{ worker: Worker, job: any }} slot */
  #replace(slot) {
    const old = slot.worker;
    slot.job = null;
    if (!this.closed) this.#attach(slot);
    void old.terminate();
    this.#pump();
  }

  /** Stop the threads; queued and running jobs fail. */
  async close() {
    this.closed = true;
    for (const q of this.queue.splice(0)) q.reject(new RenderError('RENDER_FAILED', 'the render pool is closed'));
    await Promise.all(this.slots.map((s) => { if (s.job) { clearTimeout(s.job.timer); s.job.reject(new RenderError('RENDER_FAILED', 'the render pool is closed')); s.job = null; } return s.worker.terminate(); }));
  }
}
