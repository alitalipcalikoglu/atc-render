import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config, ConfigError } from '../src/config.js';
import { testEnv } from './helpers.js';

test('Config: defaults, roles, optional media', () => {
  const c = Config.fromEnv(testEnv('http://127.0.0.1:9', { PORT: '' }));
  assert.equal(c.port, 3015);
  assert.deepEqual(c.apiKeys.map((k) => [k.id, k.role]), [['console', 'readwrite'], ['billing', 'read'], ['designer', 'write']]);
  assert.equal(c.limits.maxPages, 50);
  assert.equal(c.limits.concurrency, 4);
  assert.equal(c.media?.url, 'http://127.0.0.1:9');
  assert.equal(Config.fromEnv(testEnv('', { MEDIA_API_KEY: '' })).media, null);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.limits));
});

test('Config: rejects bad input', () => {
  const bad = (/** @type {Record<string,string>} */ o, /** @type {RegExp} */ re) => assert.throws(() => Config.fromEnv(testEnv('http://127.0.0.1:9', o)), (e) => e instanceof ConfigError && re.test(e.message));
  bad({ RENDER_API_KEYS: '' }, /RENDER_API_KEYS is required/);
  bad({ RENDER_API_KEYS: `a:${'a'.repeat(40)}:admin` }, /read, write or readwrite/);
  bad({ MEDIA_API_KEY: '' }, /must be set together/);
  bad({ MEDIA_URL: 'ftp://x' }, /absolute http/);
  bad({ MAX_TOTAL_IMAGE_BYTES: '2048', MAX_IMAGE_BYTES: '4096' }, />= MAX_IMAGE_BYTES/);
  bad({ TLS_CERT_PATH: '/c.pem' }, /must be set together/);
});
