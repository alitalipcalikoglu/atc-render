/** @typedef {import('../db.js').Database} Database */
/** @typedef {import('../types.js').TemplateRow} TemplateRow */
/** @typedef {import('../types.js').VersionRow} VersionRow */

/** Templates and their immutable numbered versions. */
export class TemplateStore {
  static T = 'name, description, latest_version, created_by, created_at, updated_at';
  static V = 'name, version, note, created_by, created_at';

  /** @param {Database} db */
  constructor(db) {
    this.db = db;
    const { T, V } = TemplateStore;
    this.stmt = {
      insert: db.prepare(`INSERT INTO templates (${T}) VALUES (?, ?, 0, ?, ?, ?)`),
      get: db.prepare(`SELECT ${T} FROM templates WHERE name = ?`),
      all: db.prepare(`SELECT ${T} FROM templates ORDER BY name`),
      describe: db.prepare('UPDATE templates SET description = ?, updated_at = ? WHERE name = ?'),
      bump: db.prepare('UPDATE templates SET latest_version = ?, updated_at = ? WHERE name = ?'),
      delete: db.prepare('DELETE FROM templates WHERE name = ?'),
      insertVersion: db.prepare('INSERT INTO template_versions (name, version, layout, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      version: db.prepare(`SELECT ${V}, layout FROM template_versions WHERE name = ? AND version = ?`),
      versions: db.prepare(`SELECT ${V} FROM template_versions WHERE name = ? ORDER BY version DESC`),
      prune: db.prepare('DELETE FROM template_versions WHERE name = ? AND version <= ?'),
      count: db.prepare('SELECT COUNT(*) AS n FROM templates'),
    };
  }

  /** @param {string} name @param {string} description @param {string} actor @param {number} now */
  insert(name, description, actor, now) {
    this.stmt.insert.run(name, description, actor, now, now);
  }

  /** @param {string} name @returns {TemplateRow|undefined} */
  get(name) {
    return /** @type {TemplateRow|undefined} */ (this.stmt.get.get(name));
  }

  /** @returns {TemplateRow[]} */
  all() {
    return /** @type {TemplateRow[]} */ (this.stmt.all.all());
  }

  /** @param {string} name @param {string} description @param {number} now */
  describe(name, description, now) {
    this.stmt.describe.run(description, now, name);
  }

  /** @param {string} name */
  delete(name) {
    return Number(this.stmt.delete.run(name).changes) === 1;
  }

  /**
   * Append the next version and prune old ones beyond `keep`.
   * @param {string} name @param {string} layout JSON @param {string} note @param {string} actor @param {number} now @param {number} keep
   */
  addVersion(name, layout, note, actor, now, keep) {
    const t = /** @type {TemplateRow} */ (this.get(name));
    const version = t.latest_version + 1;
    this.stmt.insertVersion.run(name, version, layout, note, actor, now);
    this.stmt.bump.run(version, now, name);
    this.stmt.prune.run(name, version - keep);
    return version;
  }

  /** @param {string} name @param {number} version @returns {VersionRow|undefined} */
  version(name, version) {
    return /** @type {VersionRow|undefined} */ (this.stmt.version.get(name, version));
  }

  /** @param {string} name @returns {Omit<VersionRow, 'layout'>[]} */
  versions(name) {
    return /** @type {Omit<VersionRow, 'layout'>[]} */ (this.stmt.versions.all(name));
  }

  count() {
    return Number(/** @type {{ n: number }} */ (this.stmt.count.get()).n);
  }
}
