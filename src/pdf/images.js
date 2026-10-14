import { RenderError } from '../domain/errors.js';

/**
 * Loads image blocks before drawing: base64 PNG/JPEG from the layout or an atc-media file by id.
 * Enforces the per-image, per-document count and byte caps, and accepts PNG and JPEG only (what
 * the PDF writer supports), checked by magic bytes.
 */
export class ImageLoader {
  /**
   * @param {{ media: import('../net/media-client.js').MediaClient|null, limits: import('../types.js').Limits }} deps
   */
  constructor({ media, limits }) {
    this.media = media;
    this.limits = limits;
  }

  /** @param {Buffer} b */
  static kind(b) {
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    return null;
  }

  /**
   * @param {{ block: Record<string, any>, path: string }[]} images
   * @param {AbortSignal} signal
   * @returns {Promise<Map<string, Buffer>>} path -> bytes
   */
  async load(images, signal) {
    if (images.length > this.limits.maxImages) throw new RenderError('TOO_MANY_IMAGES', `at most ${this.limits.maxImages} images per document`, { block: images[this.limits.maxImages].path });
    /** @type {Map<string, Buffer>} */
    const out = new Map();
    let total = 0;
    for (const { block, path } of images) {
      /** @type {Buffer} */
      let bytes;
      if (typeof block.data === 'string') {
        bytes = Buffer.from(block.data.replace(/\s+/g, ''), 'base64');
        if (bytes.length > this.limits.maxImageBytes) throw new RenderError('IMAGE_TOO_LARGE', `image is larger than ${this.limits.maxImageBytes} bytes`, { block: path });
      } else {
        if (!this.media) throw new RenderError('MEDIA_DISABLED', 'image blocks with fileId need MEDIA_URL and MEDIA_API_KEY', { block: path });
        bytes = await this.media.image(block.fileId, this.limits.maxImageBytes, signal, path);
      }
      if (!ImageLoader.kind(bytes)) throw new RenderError('IMAGE_UNSUPPORTED', 'images must be PNG or JPEG', { block: path });
      total += bytes.length;
      if (total > this.limits.maxTotalImageBytes) throw new RenderError('IMAGE_TOO_LARGE', `images exceed ${this.limits.maxTotalImageBytes} bytes per document`, { block: path });
      out.set(path, bytes);
    }
    return out;
  }
}
