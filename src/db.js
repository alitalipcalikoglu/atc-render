import { Database as CoreDatabase } from '@atc-web/atc-service-core/db';

/** SQLite connection with schema migrations applied on open. */
export class Database extends CoreDatabase {
  static MIGRATIONS = [
    `
    CREATE TABLE templates (
      name           TEXT PRIMARY KEY,
      description    TEXT NOT NULL DEFAULT '',
      latest_version INTEGER NOT NULL,
      created_by     TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    -- Immutable: a version is never updated, only added (and pruned past MAX_VERSIONS).
    CREATE TABLE template_versions (
      name       TEXT NOT NULL REFERENCES templates(name) ON DELETE CASCADE,
      version    INTEGER NOT NULL,
      layout     TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (name, version)
    );

    -- One row per render attempt, for stats and metrics; purged after RENDER_LOG_DAYS.
    CREATE TABLE renders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      template   TEXT,
      version    INTEGER,
      ok         INTEGER NOT NULL,
      error_code TEXT,
      ms         INTEGER NOT NULL,
      pages      INTEGER NOT NULL DEFAULT 0,
      bytes      INTEGER NOT NULL DEFAULT 0,
      stored     INTEGER NOT NULL DEFAULT 0,
      actor      TEXT NOT NULL,
      at         INTEGER NOT NULL
    );
    CREATE INDEX renders_at ON renders (at);
    `,
  ];
}
