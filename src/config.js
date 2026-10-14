import { ConfigError, EnvReader, parseApiKeys, parseAudit } from '@atc-web/atc-service-core/config';

/** @typedef {import('./types.js').ApiKey} ApiKey */
/** @typedef {import('./types.js').KeyRole} KeyRole */

export { ConfigError };

/** Validated service configuration. Build with {@link Config.fromEnv}. */
export class Config {
  static MIN_SECRET_LENGTH = 32;

  /** @param {import('./types.js').ConfigValues} v */
  constructor(v) {
    this.port = v.port;
    this.host = v.host;
    this.logLevel = v.logLevel;
    this.trustProxy = v.trustProxy;
    this.tls = v.tls;
    this.audit = v.audit;
    this.bodyLimit = v.bodyLimit;
    this.dbPath = v.dbPath;
    this.dbBackupDir = v.dbBackupDir;
    this.apiKeys = v.apiKeys;
    this.actorKeys = v.actorKeys;
    this.rateLimitMax = v.rateLimitMax;
    this.media = v.media;
    this.limits = Object.freeze({ ...v.limits });
    Object.freeze(this);
  }

  /**
   * @param {NodeJS.ProcessEnv} [env]
   * @returns {Config}
   */
  static fromEnv(env = process.env) {
    const r = new EnvReader(env);
    const certPath = r.optional('TLS_CERT_PATH');
    const keyPath = r.optional('TLS_KEY_PATH');
    if (Boolean(certPath) !== Boolean(keyPath)) throw new ConfigError('TLS_CERT_PATH and TLS_KEY_PATH must be set together');

    const mediaUrl = r.optional('MEDIA_URL').replace(/\/+$/, '');
    const mediaKey = r.optional('MEDIA_API_KEY');
    if (Boolean(mediaUrl) !== Boolean(mediaKey)) throw new ConfigError('MEDIA_URL and MEDIA_API_KEY must be set together');
    if (mediaUrl && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(mediaUrl)) throw new ConfigError('MEDIA_URL must be an absolute http(s) URL');
    if (mediaKey && mediaKey.length < Config.MIN_SECRET_LENGTH) throw new ConfigError(`MEDIA_API_KEY must be at least ${Config.MIN_SECRET_LENGTH} characters`);

    const maxImageBytes = r.integer('MAX_IMAGE_BYTES', 2_097_152, { min: 1_024 });
    const maxTotalImageBytes = r.integer('MAX_TOTAL_IMAGE_BYTES', 10_485_760, { min: 1_024 });
    if (maxTotalImageBytes < maxImageBytes) throw new ConfigError('MAX_TOTAL_IMAGE_BYTES must be >= MAX_IMAGE_BYTES');

    const apiKeys = Config.#parseApiKeys(r.required('RENDER_API_KEYS'));
    return new Config({
      port: r.integer('PORT', 3015, { min: 0, max: 65535 }),
      host: r.optional('HOST') || '0.0.0.0',
      logLevel: r.optional('LOG_LEVEL') || 'info',
      trustProxy: r.boolean('TRUST_PROXY', false),
      tls: certPath ? { certPath, keyPath } : null,
      audit: parseAudit(r),
      bodyLimit: r.integer('BODY_LIMIT', 4_194_304, { min: 16_384 }),
      dbPath: r.optional('DB_PATH') || './data/render.db',
      dbBackupDir: r.optional('DB_BACKUP_DIR') || undefined,
      apiKeys,
      actorKeys: Config.#actorKeys(r, apiKeys),
      rateLimitMax: r.integer('RATE_LIMIT_MAX', 600, { min: 1 }),
      media: mediaUrl ? { url: mediaUrl, apiKey: mediaKey } : null,
      limits: {
        maxPages: r.integer('MAX_PAGES', 50, { min: 1, max: 2_000 }),
        maxDataBytes: r.integer('MAX_DATA_BYTES', 262_144, { min: 1_024 }),
        maxLayoutBytes: r.integer('MAX_LAYOUT_BYTES', 131_072, { min: 1_024 }),
        maxImages: r.integer('MAX_IMAGES', 20, { min: 0, max: 500 }),
        maxImageBytes,
        maxTotalImageBytes,
        maxPdfBytes: r.integer('MAX_PDF_BYTES', 20_971_520, { min: 65_536 }),
        maxTableRows: r.integer('MAX_TABLE_ROWS', 5_000, { min: 1 }),
        renderTimeoutMs: r.integer('RENDER_TIMEOUT_MS', 15_000, { min: 500 }),
        concurrency: r.integer('RENDER_CONCURRENCY', 4, { min: 1, max: 64 }),
        workers: r.integer('RENDER_WORKERS', 2, { min: 0, max: 32 }),
        mediaTimeoutMs: r.integer('MEDIA_TIMEOUT_MS', 10_000, { min: 500 }),
        downloadTtlSec: r.integer('DOWNLOAD_TTL_SEC', 300, { min: 30, max: 86_400 }),
        logRetentionDays: r.integer('RENDER_LOG_DAYS', 30, { min: 1 }),
        maxVersions: r.integer('MAX_VERSIONS', 100, { min: 1 }),
      },
    });
  }

  /**
   * `ACTOR_KEYS`: ids of keys allowed to name the acting person in `X-Actor` (the console).
   * @param {EnvReader} r @param {ApiKey[]} apiKeys
   */
  static #actorKeys(r, apiKeys) {
    const ids = r.optional('ACTOR_KEYS').split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of ids) if (!apiKeys.some((k) => k.id === id)) throw new ConfigError(`ACTOR_KEYS names "${id}", which is not a key id in the API keys`);
    return ids;
  }

  /** @param {string} raw @returns {ApiKey[]} */
  static #parseApiKeys(raw) {
    return parseApiKeys(raw, 'RENDER_API_KEYS', { roles: ['read', 'write', 'readwrite'], minSecretLength: Config.MIN_SECRET_LENGTH, roleErrorMessage: () => 'must be read, write or readwrite' })
      .map(({ id, secret, role }) => ({ id, secret, role: /** @type {KeyRole} */ (role) }));
  }
}
