/** Domain error with a stable code and the HTTP status the API maps it to. */
export class RenderError extends Error {
  /** @type {Record<string, number>} */
  static STATUS = {
    TEMPLATE_NOT_FOUND: 404,
    VERSION_NOT_FOUND: 404,
    TEMPLATE_EXISTS: 409,
    INVALID_LAYOUT: 400,
    DATA_TOO_LARGE: 413,
    LAYOUT_TOO_LARGE: 413,
    RENDER_FAILED: 422,
    TOO_MANY_PAGES: 422,
    TOO_MANY_IMAGES: 422,
    IMAGE_TOO_LARGE: 422,
    IMAGE_UNSUPPORTED: 422,
    RENDER_TIMEOUT: 422,
    PDF_TOO_LARGE: 422,
    MEDIA_DISABLED: 400,
    MEDIA_ERROR: 502,
    BUSY: 429,
    FORBIDDEN: 403,
  };

  /**
   * @param {keyof typeof RenderError.STATUS} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]  `block` names the failing block path, e.g. `blocks[3].rows`.
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.statusCode = RenderError.STATUS[code];
    this.details = details;
  }
}
