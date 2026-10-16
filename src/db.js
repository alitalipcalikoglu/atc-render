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
    `
    -- Asynchronous renders (POST /v1/renders): queued, drawn in the background, kept until
    -- RENDER_JOB_HOURS after they finish. The PDF is kept here unless the job stored it in media.
    CREATE TABLE jobs (
      id            TEXT PRIMARY KEY,
      owner         TEXT NOT NULL,
      actor         TEXT NOT NULL,
      template      TEXT NOT NULL,
      version       INTEGER NOT NULL,
      data          TEXT NOT NULL,
      filename      TEXT NOT NULL,
      store         INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
      error_code    TEXT,
      error_message TEXT,
      pages         INTEGER,
      bytes         INTEGER,
      pdf           BLOB,
      file_id       TEXT,
      url           TEXT,
      url_expires_at INTEGER,
      created_at    INTEGER NOT NULL,
      started_at    INTEGER,
      finished_at   INTEGER
    );
    CREATE INDEX jobs_status ON jobs (status, created_at);
    CREATE INDEX jobs_owner ON jobs (owner, created_at);
    `,
    `
    -- A queued job can be cancelled; SQLite cannot widen a CHECK, so the table is rebuilt.
    CREATE TABLE jobs_v2 (
      id            TEXT PRIMARY KEY,
      owner         TEXT NOT NULL,
      actor         TEXT NOT NULL,
      template      TEXT NOT NULL,
      version       INTEGER NOT NULL,
      data          TEXT NOT NULL,
      filename      TEXT NOT NULL,
      store         INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      error_code    TEXT,
      error_message TEXT,
      pages         INTEGER,
      bytes         INTEGER,
      pdf           BLOB,
      file_id       TEXT,
      url           TEXT,
      url_expires_at INTEGER,
      created_at    INTEGER NOT NULL,
      started_at    INTEGER,
      finished_at   INTEGER
    );
    INSERT INTO jobs_v2 SELECT id, owner, actor, template, version, data, filename, store, status, error_code, error_message, pages, bytes, pdf, file_id, url, url_expires_at, created_at, started_at, finished_at FROM jobs;
    DROP TABLE jobs;
    ALTER TABLE jobs_v2 RENAME TO jobs;
    CREATE INDEX jobs_status ON jobs (status, created_at);
    CREATE INDEX jobs_owner ON jobs (owner, created_at);
    `,
  ];
}
