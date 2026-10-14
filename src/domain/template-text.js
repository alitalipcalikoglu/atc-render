/**
 * `{{path}}` placeholders, `if` conditions and the small inline markup (`**bold**`, `_italic_`)
 * of layout text. Paths read own properties only, so a layout can never reach prototypes.
 */
export class TemplateText {
  static PLACEHOLDER = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*)\s*\}\}/g;
  static MARKUP = /\*\*(.+?)\*\*|(?<![\p{L}\p{N}])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}])/gu;

  /**
   * @param {unknown} root
   * @param {string} path  Dot path; array elements by index (`items.0.name`).
   * @returns {unknown}
   */
  static get(root, path) {
    let cur = root;
    for (const part of path.split('.')) {
      if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) return undefined;
      cur = /** @type {Record<string, unknown>} */ (cur)[part];
    }
    return cur;
  }

  /** @param {unknown} v */
  static stringify(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
    return JSON.stringify(v);
  }

  /**
   * Replace placeholders; each path is looked up in `scopes` in order (a table row, then the data).
   * @param {string} text
   * @param {unknown[]} scopes
   */
  static fill(text, scopes) {
    return text.replace(TemplateText.PLACEHOLDER, (_m, path) => {
      for (const s of scopes) {
        const v = TemplateText.get(s, path);
        if (v !== undefined) return TemplateText.stringify(v);
      }
      return '';
    });
  }

  /** Truthiness of `if`: empty arrays, empty strings, 0, false, null and missing are false. @param {string} cond @param {unknown} data */
  static test(cond, data) {
    const negate = cond.startsWith('!');
    const v = TemplateText.get(data, negate ? cond.slice(1) : cond);
    const truthy = Array.isArray(v) ? v.length > 0 : Boolean(v);
    return negate ? !truthy : truthy;
  }

  /**
   * Split markup into runs first, then fill placeholders inside each run, so values from data can
   * never introduce formatting.
   * @param {string} text
   * @param {unknown[]} scopes
   * @returns {{ text: string, bold?: boolean, italic?: boolean }[]}
   */
  static runs(text, scopes) {
    /** @type {{ text: string, bold?: boolean, italic?: boolean }[]} */
    const out = [];
    let last = 0;
    for (const m of text.matchAll(TemplateText.MARKUP)) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], italic: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out.map((r) => ({ ...r, text: TemplateText.fill(r.text, scopes) })).filter((r) => r.text !== '');
  }
}
