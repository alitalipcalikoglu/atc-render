import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { ConfigError } from '../config.js';

/** @typedef {{ regular: string, bold: string, italic: string, bolditalic: string }} FontFaces */

/**
 * Extra TrueType/OpenType families from `FONTS_DIR`, read once at startup. A family is one or more
 * files named `<Family>.ttf` or `<Family>-Regular.ttf`, plus optional `-Bold`, `-Italic`
 * (or `-Oblique`) and `-BoldItalic` (or `-BoldOblique`) files. The family id is the lower-cased
 * file stem; a missing face falls back to the regular one. Every file is opened once here, so a
 * broken font fails startup instead of a render.
 */
export class FontCatalog {
  static FILE = /^([A-Za-z0-9][A-Za-z0-9_]{0,47})(?:-(Regular|Bold|Italic|Oblique|BoldItalic|BoldOblique))?\.(ttf|otf)$/i;
  static RESERVED = new Set(['sans', 'mono', 'dejavu']);
  static MAX_FONT_BYTES = 30 * 1024 * 1024;

  /**
   * @param {string|null} dir
   * @returns {Record<string, FontFaces>}
   */
  static scan(dir) {
    if (!dir) return {};
    const root = resolve(dir);
    let names;
    try {
      names = readdirSync(root);
    } catch (err) {
      throw new ConfigError(`FONTS_DIR "${dir}" cannot be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    /** @type {Record<string, Partial<FontFaces>>} */
    const found = {};
    for (const name of names.sort()) {
      const m = FontCatalog.FILE.exec(name);
      if (!m) continue;
      const id = m[1].toLowerCase();
      if (FontCatalog.RESERVED.has(id)) throw new ConfigError(`FONTS_DIR: family name "${id}" is reserved`);
      const path = join(root, name);
      const st = statSync(path);
      if (!st.isFile() || st.size > FontCatalog.MAX_FONT_BYTES) throw new ConfigError(`FONTS_DIR: ${name} is not a regular file under ${FontCatalog.MAX_FONT_BYTES} bytes`);
      const style = (m[2] ?? 'regular').toLowerCase().replace('oblique', 'italic');
      const face = /** @type {keyof FontFaces} */ (style);
      (found[id] ??= {})[face] = path;
    }
    /** @type {Record<string, FontFaces>} */
    const out = {};
    const probe = new PDFDocument();
    for (const [id, f] of Object.entries(found)) {
      if (!f.regular) throw new ConfigError(`FONTS_DIR: family "${id}" has no regular face (${id}.ttf or ${id}-Regular.ttf)`);
      const faces = { regular: f.regular, bold: f.bold ?? f.regular, italic: f.italic ?? f.regular, bolditalic: f.bolditalic ?? f.bold ?? f.italic ?? f.regular };
      for (const path of new Set(Object.values(faces))) {
        try {
          probe.font(path);
        } catch (err) {
          throw new ConfigError(`FONTS_DIR: ${path} is not a usable font: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      out[id] = faces;
    }
    return out;
  }
}
