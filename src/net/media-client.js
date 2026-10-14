import { RenderError } from '../domain/errors.js';

/**
 * The only network peer of this service: atc-media, for image blocks by file id and for stored
 * renders. Signed file URLs are fetched through MEDIA_URL (the internal address) whatever host they
 * name, never followed through redirects, and read with a byte cap.
 */
export class MediaClient {
  /**
   * @param {{ upstream: import('../types.js').Upstream, timeoutMs: number, fetch?: typeof fetch }} o
   */
  constructor({ upstream, timeoutMs, fetch: fetchImpl = fetch }) {
    this.upstream = upstream;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  /**
   * @param {string} method @param {string} path
   * @param {{ body?: BodyInit, headers?: Record<string, string>, auth?: boolean, signal?: AbortSignal }} [o]
   */
  async #call(method, path, { body, headers = {}, auth = true, signal } = {}) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    try {
      return await this.fetch(`${this.upstream.url}${path}`, {
        method, body, redirect: 'error',
        headers: { ...(auth ? { authorization: `Bearer ${this.upstream.apiKey}` } : {}), ...headers },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw new RenderError('RENDER_TIMEOUT', 'render timed out while talking to atc-media');
      throw new RenderError('MEDIA_ERROR', `atc-media unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** @param {Response} res @param {string} what */
  static async #fail(res, what) {
    let message = `atc-media ${what} responded ${res.status}`;
    try { const j = await res.json(); if (j?.error?.message) message = `atc-media: ${j.error.message}`; } catch { /* not JSON */ }
    return message;
  }

  /** @param {string} id @param {number} ttl @param {AbortSignal} [signal] @returns {Promise<{ url: string, expiresAt: string|null }>} */
  async signed(id, ttl, signal) {
    const res = await this.#call('POST', `/v1/files/${encodeURIComponent(id)}/urls?ttl=${ttl}`, { signal });
    if (!res.ok) throw new RenderError(res.status === 404 ? 'RENDER_FAILED' : 'MEDIA_ERROR', await MediaClient.#fail(res, 'urls'));
    const original = (await res.json()).urls.original;
    return { url: String(original.url), expiresAt: original.expiresAt ?? null };
  }

  /**
   * Bytes of a file's original, at most `maxBytes`.
   * @param {string} id @param {number} maxBytes @param {AbortSignal} signal @param {string} block
   * @returns {Promise<Buffer>}
   */
  async image(id, maxBytes, signal, block) {
    let signed;
    try { signed = await this.signed(id, 60, signal); } catch (err) {
      if (err instanceof RenderError && err.code === 'RENDER_FAILED') throw new RenderError('RENDER_FAILED', `media file ${id} not found`, { block });
      throw err;
    }
    const u = new URL(signed.url);
    const res = await this.#call('GET', `${u.pathname}${u.search}`, { auth: false, signal });
    if (!res.ok) throw new RenderError('RENDER_FAILED', await MediaClient.#fail(res, 'file'), { block });
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) { await res.body?.cancel(); throw new RenderError('IMAGE_TOO_LARGE', `image is larger than ${maxBytes} bytes`, { block }); }
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    for await (const c of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (res.body ?? []))) {
      size += c.length;
      if (size > maxBytes) throw new RenderError('IMAGE_TOO_LARGE', `image is larger than ${maxBytes} bytes`, { block });
      chunks.push(Buffer.from(c));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Store a PDF as a private file and return a signed URL.
   * @param {Buffer} pdf @param {string} name @param {number} ttl
   */
  async store(pdf, name, ttl) {
    const res = await this.#call('PUT', `/v1/files?visibility=private&name=${encodeURIComponent(name)}`, { body: /** @type {any} */ (pdf), headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) } });
    if (!res.ok) throw new RenderError('MEDIA_ERROR', await MediaClient.#fail(res, 'upload'));
    const file = (await res.json()).file;
    const signed = await this.signed(String(file.id), ttl);
    return { fileId: String(file.id), ...signed };
  }
}
