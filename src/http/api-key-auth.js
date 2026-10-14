import { ApiKeyAuth as CoreApiKeyAuth } from '@atc-web/atc-service-core/auth';
import { RenderError } from '../domain/errors.js';

/** @typedef {import('../types.js').ApiKey} ApiKey */

/** Bearer API-key authentication with read/write roles. Thin wrapper over service-core's `ApiKeyAuth`. */
export class ApiKeyAuth {
  /** @param {ApiKey[]} apiKeys */
  constructor(apiKeys) {
    this.core = new CoreApiKeyAuth(apiKeys);
  }

  /** Fastify `onRequest` hook. */
  get hook() {
    return this.core.hook;
  }

  /** @param {'read'|'write'} need */
  static require(need) {
    return CoreApiKeyAuth.require(need, {
      roleOf: (request) => /** @type {any} */ (request).apiKey?.role,
      makeError: (n) => new RenderError('FORBIDDEN', `this API key has no ${n} access`),
    });
  }
}
