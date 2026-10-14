import { inflateSync } from 'node:zlib';

/**
 * Test-only PDF text extraction for the documents this service writes: walks pages, maps each
 * page's fonts to their ToUnicode CMaps and decodes the hex glyph strings of TJ/Tj operators.
 * Handles compressed and uncompressed streams. Enough to prove Turkish text round-trips.
 */
export class PdfText {
  /** @param {Buffer} pdf @returns {string[]} one string per page */
  static pages(pdf) {
    const src = pdf.toString('latin1');
    /** @type {Map<number, { dict: string, stream: Buffer|null }>} */
    const objects = new Map();
    for (const m of src.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
      const body = m[2];
      const at = body.indexOf('stream');
      let stream = null;
      let dict = body;
      if (at >= 0 && /<<[\s\S]*>>\s*stream/.test(body)) {
        dict = body.slice(0, at);
        const start = m.index + m[0].indexOf('stream') + 'stream'.length + (src[m.index + m[0].indexOf('stream') + 6] === '\r' ? 2 : 1);
        const end = src.indexOf('endstream', start);
        let raw = Buffer.from(src.slice(start, end).replace(/\r?\n$/, ''), 'latin1');
        if (/\/FlateDecode/.test(dict)) raw = inflateSync(raw);
        stream = raw;
      }
      objects.set(Number(m[1]), { dict, stream });
    }
    const ref = (/** @type {string} */ s, /** @type {string} */ key) => { const r = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(s); return r ? Number(r[1]) : null; };
    const pagesRoot = [...objects.values()].find((o) => /\/Type\s*\/Pages/.test(o.dict) && /\/Kids/.test(o.dict));
    const kids = [...(/\/Kids\s*\[([^\]]*)\]/.exec(pagesRoot?.dict ?? '')?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));
    return kids.map((id) => {
      const page = /** @type {{ dict: string }} */ (objects.get(id));
      const resId = ref(page.dict, 'Resources');
      const res = resId ? objects.get(resId)?.dict ?? '' : page.dict;
      const fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(res)?.[1] ?? '';
      /** @type {Map<string, Map<number, string>>} */
      const cmaps = new Map();
      for (const f of fontDict.matchAll(/\/(F\d+)\s+(\d+) 0 R/g)) {
        const font = objects.get(Number(f[2]))?.dict ?? '';
        const tu = ref(font, 'ToUnicode');
        cmaps.set(f[1], PdfText.#cmap(tu ? objects.get(tu)?.stream?.toString('latin1') ?? '' : ''));
      }
      const contents = ref(page.dict, 'Contents');
      const ops = contents ? objects.get(contents)?.stream?.toString('latin1') ?? '' : '';
      let font = new Map();
      let out = '';
      for (const t of ops.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
        if (t[1]) { font = cmaps.get(t[1]) ?? new Map(); continue; }
        const hexes = t[2] !== undefined ? [...t[2].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]) : [t[3]];
        for (const h of hexes) for (let i = 0; i + 4 <= h.length; i += 4) out += font.get(parseInt(h.slice(i, i + 4), 16)) ?? '';
        out += '\n';
      }
      return out;
    });
  }

  /** @param {string} s */
  static #cmap(s) {
    /** @type {Map<number, string>} */
    const map = new Map();
    // Ligatures map to several code points, written with spaces: <0066 0069>.
    const u = (/** @type {string} */ hex) => String.fromCodePoint(...(hex.replace(/\s+/g, '').match(/.{4}/g) ?? []).map((x) => parseInt(x, 16)));
    for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const r of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
        const lo = parseInt(r[1], 16);
        const hi = parseInt(r[2], 16);
        if (r[3].startsWith('[')) [...r[3].matchAll(/<([0-9a-fA-F\s]+)>/g)].forEach((x, i) => map.set(lo + i, u(x[1])));
        else for (let c = lo, v = parseInt(r[3].slice(1, -1), 16); c <= hi; c++, v++) map.set(c, String.fromCodePoint(v));
      }
    }
    for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const r of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(r[1], 16), u(r[2]));
    return map;
  }
}
