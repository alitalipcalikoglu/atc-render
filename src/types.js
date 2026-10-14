/**
 * Shared JSDoc typedefs for the render service. No runtime exports.
 */

/** @typedef {'read'|'write'|'readwrite'} KeyRole */
/** @typedef {{ id: string, secret: string, role: KeyRole }} ApiKey */
/** @typedef {{ url: string, apiKey: string }} Upstream */

/**
 * @typedef {object} Limits
 * @property {number} maxPages
 * @property {number} maxDataBytes        JSON-encoded size of `data`.
 * @property {number} maxLayoutBytes      JSON-encoded size of a layout.
 * @property {number} maxImages           Image blocks actually drawn per document.
 * @property {number} maxImageBytes       Per image.
 * @property {number} maxTotalImageBytes  Per document.
 * @property {number} maxPdfBytes
 * @property {number} maxTableRows        Rows per table block.
 * @property {number} renderTimeoutMs
 * @property {number} concurrency         Renders at the same time; more answer 429.
 * @property {number} mediaTimeoutMs
 * @property {number} downloadTtlSec
 * @property {number} logRetentionDays
 * @property {number} maxVersions         Versions kept per template; older ones are pruned.
 */

/**
 * @typedef {object} ConfigValues
 * @property {number} port
 * @property {string} host
 * @property {string} logLevel
 * @property {boolean} trustProxy
 * @property {{ certPath: string, keyPath: string }|null} tls
 * @property {Upstream|null} audit
 * @property {number} bodyLimit
 * @property {string} dbPath
 * @property {string} [dbBackupDir]
 * @property {ApiKey[]} apiKeys
 * @property {number} rateLimitMax
 * @property {Upstream|null} media   Image blocks by file id and stored renders; null = both off.
 * @property {Limits} limits
 */

/**
 * @typedef {object} TemplateRow
 * @property {string} name
 * @property {string} description
 * @property {number} latest_version
 * @property {string} created_by
 * @property {number} created_at
 * @property {number} updated_at
 */

/**
 * @typedef {object} VersionRow
 * @property {string} name
 * @property {number} version
 * @property {string} layout   JSON.
 * @property {string} note
 * @property {string} created_by
 * @property {number} created_at
 */

/**
 * A validated layout. Blocks are described by the JSON schema in `domain/layout-schema.js`.
 * @typedef {object} Layout
 * @property {{ size?: 'A4'|'Letter'|'A5', orientation?: 'portrait'|'landscape', margins?: { top?: number, right?: number, bottom?: number, left?: number }, fontSize?: number }} [page]
 * @property {{ text: string, align?: 'left'|'center'|'right' }} [header]
 * @property {{ text: string, align?: 'left'|'center'|'right' }} [footer]
 * @property {Record<string, any>[]} blocks
 */

/** @typedef {import('fastify').FastifyBaseLogger} Logger */

export {};
