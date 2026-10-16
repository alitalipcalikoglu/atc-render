/** @typedef {import('../db.js').Database} Database */

/**
 * @typedef {object} JobRow
 * @property {string} id
 * @property {string} owner        API key id that submitted it; only that key can read it.
 * @property {string} actor
 * @property {string} template
 * @property {number} version      Pinned at submit time.
 * @property {string} data         JSON.
 * @property {string} filename
 * @property {number} store
 * @property {'queued'|'running'|'succeeded'|'failed'|'cancelled'} status
 * @property {string|null} error_code
 * @property {string|null} error_message
 * @property {number|null} pages
 * @property {number|null} bytes
 * @property {Uint8Array|null} [pdf]
 * @property {string|null} file_id
 * @property {string|null} url
 * @property {number|null} url_expires_at
 * @property {number} created_at
 * @property {number|null} started_at
 * @property {number|null} finished_at
 */

/** Persistence of asynchronous render jobs. */
export class JobStore {
  static COLUMNS = 'id, owner, actor, template, version, data, filename, store, status, error_code, error_message, pages, bytes, file_id, url, url_expires_at, created_at, started_at, finished_at';

  /** @param {Database} db */
  constructor(db) {
    const c = JobStore.COLUMNS;
    this.stmt = {
      insert: db.prepare('INSERT INTO jobs (id, owner, actor, template, version, data, filename, store, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'queued\', ?)'),
      get: db.prepare(`SELECT ${c} FROM jobs WHERE id = ?`),
      pdf: db.prepare('SELECT pdf FROM jobs WHERE id = ?'),
      list: db.prepare(`SELECT ${c} FROM jobs WHERE owner = ? AND (? IS NULL OR status = ?) AND id < ? ORDER BY id DESC LIMIT ?`),
      next: db.prepare(`SELECT ${c} FROM jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1`),
      claim: db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'"),
      requeue: db.prepare("UPDATE jobs SET status = 'queued', started_at = NULL WHERE id = ?"),
      recover: db.prepare("UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'"),
      succeed: db.prepare("UPDATE jobs SET status = 'succeeded', pages = ?, bytes = ?, pdf = ?, file_id = ?, url = ?, url_expires_at = ?, data = '{}', finished_at = ? WHERE id = ?"),
      cancel: db.prepare("UPDATE jobs SET status = 'cancelled', data = '{}', finished_at = ? WHERE id = ? AND status = 'queued'"),
      fail: db.prepare("UPDATE jobs SET status = 'failed', error_code = ?, error_message = ?, data = '{}', finished_at = ? WHERE id = ?"),
      pending: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running')"),
      counts: db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status'),
      purge: db.prepare('DELETE FROM jobs WHERE finished_at IS NOT NULL AND finished_at < ?'),
    };
  }

  /** @param {{ id: string, owner: string, actor: string, template: string, version: number, data: string, filename: string, store: boolean }} j @param {number} now */
  insert(j, now) { this.stmt.insert.run(j.id, j.owner, j.actor, j.template, j.version, j.data, j.filename, j.store ? 1 : 0, now); }
  /** @param {string} id @returns {JobRow|undefined} */
  get(id) { return /** @type {any} */ (this.stmt.get.get(id)); }
  /** @param {string} id @returns {Buffer|null} */
  pdf(id) { const r = /** @type {{ pdf: Uint8Array|null }|undefined} */ (this.stmt.pdf.get(id)); return r?.pdf ? Buffer.from(r.pdf) : null; }
  /** Only a queued job can be cancelled; a running one finishes. @param {string} id @param {number} now @returns {boolean} */
  cancel(id, now) { return Number(this.stmt.cancel.run(now, id).changes) === 1; }

  /** Newest first; ids sort by creation time, so `before` (an id) is the keyset cursor. @param {string} owner @param {{ status?: string, before?: string, limit: number }} q @returns {JobRow[]} */
  list(owner, q) { return /** @type {any} */ (this.stmt.list.all(owner, q.status ?? null, q.status ?? null, q.before ?? '~', q.limit)); }
  /** Oldest queued job, claimed as running; undefined when the queue is empty. @param {number} now @returns {JobRow|undefined} */
  claimNext(now) {
    for (;;) {
      const j = /** @type {JobRow|undefined} */ (this.stmt.next.get());
      if (!j) return undefined;
      if (Number(this.stmt.claim.run(now, j.id).changes) === 1) return { ...j, status: 'running', started_at: now };
    }
  }
  /** @param {string} id */
  requeue(id) { this.stmt.requeue.run(id); }
  /** Jobs left running by a crash go back to the queue. */
  recover() { return Number(this.stmt.recover.run().changes); }
  /** @param {string} id @param {{ pages: number, bytes: number, pdf: Buffer|null, fileId: string|null, url: string|null, urlExpiresAt: number|null }} r @param {number} now */
  succeed(id, r, now) { this.stmt.succeed.run(r.pages, r.bytes, r.pdf, r.fileId, r.url, r.urlExpiresAt, now, id); }
  /** @param {string} id @param {string} code @param {string} message @param {number} now */
  fail(id, code, message, now) { this.stmt.fail.run(code, message.slice(0, 500), now, id); }
  pending() { return Number(/** @type {{ n: number }} */ (this.stmt.pending.get()).n); }
  /** @returns {Record<string, number>} */
  counts() { return Object.fromEntries(/** @type {{ status: string, n: number }[]} */ (this.stmt.counts.all()).map((r) => [r.status, Number(r.n)])); }
  /** @param {number} before */
  purge(before) { return Number(this.stmt.purge.run(before).changes); }
}
