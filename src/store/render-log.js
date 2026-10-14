/** @typedef {import('../db.js').Database} Database */

/** One row per render attempt: the source of stats and metrics. */
export class RenderLog {
  /** @param {Database} db */
  constructor(db) {
    this.stmt = {
      insert: db.prepare('INSERT INTO renders (template, version, ok, error_code, ms, pages, bytes, stored, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      since: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(ok), 0) AS ok, COALESCE(AVG(CASE WHEN ok = 1 THEN ms END), 0) AS avg_ms, COALESCE(SUM(pages), 0) AS pages, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(stored), 0) AS stored FROM renders WHERE at >= ?'),
      errors: db.prepare('SELECT error_code AS code, COUNT(*) AS n FROM renders WHERE at >= ? AND ok = 0 GROUP BY error_code ORDER BY n DESC'),
      byTemplate: db.prepare("SELECT COALESCE(template, '(preview)') AS template, COUNT(*) AS n FROM renders WHERE at >= ? GROUP BY template ORDER BY n DESC LIMIT 20"),
      purge: db.prepare('DELETE FROM renders WHERE at < ?'),
    };
  }

  /** @param {{ template: string|null, version: number|null, ok: boolean, errorCode?: string|null, ms: number, pages?: number, bytes?: number, stored?: boolean, actor: string }} r @param {number} now */
  record(r, now) {
    this.stmt.insert.run(r.template, r.version, r.ok ? 1 : 0, r.errorCode ?? null, Math.round(r.ms), r.pages ?? 0, r.bytes ?? 0, r.stored ? 1 : 0, r.actor, now);
  }

  /** @param {number} since */
  summary(since) {
    const s = /** @type {{ n: number, ok: number, avg_ms: number, pages: number, bytes: number, stored: number }} */ (this.stmt.since.get(since));
    return {
      renders: Number(s.n), succeeded: Number(s.ok), failed: Number(s.n) - Number(s.ok), avgMs: Math.round(Number(s.avg_ms)), pages: Number(s.pages), bytes: Number(s.bytes), stored: Number(s.stored),
      errors: Object.fromEntries(/** @type {{ code: string, n: number }[]} */ (this.stmt.errors.all(since)).map((e) => [e.code, Number(e.n)])),
      byTemplate: Object.fromEntries(/** @type {{ template: string, n: number }[]} */ (this.stmt.byTemplate.all(since)).map((e) => [e.template, Number(e.n)])),
    };
  }

  /** @param {number} before */
  purge(before) {
    return Number(this.stmt.purge.run(before).changes);
  }
}
