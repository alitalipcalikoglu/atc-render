import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { RenderError } from '../domain/errors.js';
import { TemplateText } from '../domain/template-text.js';
import { QrCode, QrTooLongError } from './qr-code.js';

/** @typedef {import('../types.js').Layout} Layout */
/** @typedef {InstanceType<typeof PDFDocument>} Doc */

/**
 * Draws a validated layout with data into a PDF. Fonts are the vendored DejaVu files (Unicode,
 * so Turkish and most European scripts render); images are only ever Buffers that the
 * {@link ImageLoader} fetched and checked, never paths or URLs, so a layout cannot make the PDF
 * writer read files or the network. Rendering is synchronous between cooperative checks of the
 * deadline and the page cap.
 */
export class Renderer {
  static FONTS_DIR = fileURLToPath(new URL('../../fonts/', import.meta.url));
  static FONTS = {
    sans: 'DejaVuSans.ttf',
    'sans-bold': 'DejaVuSans-Bold.ttf',
    'sans-italic': 'DejaVuSans-Oblique.ttf',
    'sans-bolditalic': 'DejaVuSans-BoldOblique.ttf',
    mono: 'DejaVuSansMono.ttf',
  };
  static HEADING = { 1: 2, 2: 1.5, 3: 1.2 };
  static PAD = 4;

  /**
   * @param {{ images: import('./images.js').ImageLoader, limits: import('../types.js').Limits, compress?: boolean, now?: () => number }} deps
   */
  constructor({ images, limits, compress = true, now = Date.now }) {
    this.images = images;
    this.limits = limits;
    this.compress = compress;
    this.now = now;
  }

  /**
   * Blocks that will be drawn (their `if` holds), with their paths.
   * @param {Layout} layout @param {unknown} data
   */
  static visible(layout, data) {
    return layout.blocks.map((block, i) => ({ block, path: `blocks[${i}]` })).filter(({ block }) => !block.if || TemplateText.test(block.if, data));
  }

  /**
   * @param {Layout} layout
   * @param {unknown} data
   * @param {{ title?: string }} [meta]
   * @returns {Promise<{ pdf: Buffer, pages: number }>}
   */
  async render(layout, data, meta = {}) {
    const deadline = this.now() + this.limits.renderTimeoutMs;
    const signal = AbortSignal.timeout(this.limits.renderTimeoutMs);
    const blocks = Renderer.visible(layout, data);
    const images = await this.images.load(blocks.filter(({ block }) => block.type === 'image'), signal);
    const page = layout.page ?? {};
    const m = { top: 56, right: 56, bottom: 56, left: 56, ...(page.margins ?? {}) };
    const doc = new PDFDocument({
      size: page.size ?? 'A4', layout: page.orientation ?? 'portrait', margins: m, bufferPages: true, compress: this.compress,
      info: { Title: meta.title ?? 'Document', Producer: 'atc-render', Creator: 'atc-render' },
    });
    for (const [name, file] of Object.entries(Renderer.FONTS)) doc.registerFont(name, `${Renderer.FONTS_DIR}${file}`);
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    doc.on('data', (c) => { size += c.length; chunks.push(c); });
    const ended = new Promise((resolve) => doc.on('end', resolve));
    let pages = 1;
    doc.on('pageAdded', () => {
      pages++;
      if (pages > this.limits.maxPages) throw new RenderError('TOO_MANY_PAGES', `the document would exceed MAX_PAGES (${this.limits.maxPages})`, { block: ctx.path });
    });
    const base = page.fontSize ?? 10;
    const ctx = {
      doc, data, base, path: '', images,
      check: () => { if (this.now() > deadline) throw new RenderError('RENDER_TIMEOUT', `render exceeded RENDER_TIMEOUT_MS (${this.limits.renderTimeoutMs})`, { block: ctx.path }); },
    };
    doc.font('sans').fontSize(base).fillColor('#111111');
    for (const { block, path } of blocks) {
      ctx.path = path;
      ctx.check();
      try {
        this.#block(ctx, block);
      } catch (err) {
        if (err instanceof RenderError) throw err;
        throw new RenderError('RENDER_FAILED', err instanceof Error ? err.message : String(err), { block: path });
      }
    }
    ctx.path = 'header/footer';
    Renderer.#bands(doc, layout, data, m, base);
    doc.end();
    await ended;
    if (size > this.limits.maxPdfBytes) throw new RenderError('PDF_TOO_LARGE', `the PDF exceeds MAX_PDF_BYTES (${this.limits.maxPdfBytes})`);
    return { pdf: Buffer.concat(chunks), pages };
  }

  /** @param {any} ctx @param {Record<string, any>} b */
  #block(ctx, b) {
    const { doc, data, base } = ctx;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    switch (b.type) {
      case 'heading': {
        const size = base * Renderer.HEADING[/** @type {1|2|3} */ (b.level ?? 1)];
        Renderer.#ensure(doc, size * 1.6);
        doc.font('sans-bold').fontSize(size).fillColor(b.color ?? '#111111').text(TemplateText.fill(b.text, [data]), doc.page.margins.left, doc.y, { width, align: b.align ?? 'left' });
        doc.moveDown(0.4).font('sans').fontSize(base).fillColor('#111111');
        break;
      }
      case 'text': {
        const runs = b.runs ? b.runs.map((/** @type {any} */ r) => ({ ...r, text: TemplateText.fill(r.text, [data]) })).filter((/** @type {any} */ r) => r.text !== '') : TemplateText.runs(b.text, [data]);
        if (!runs.length) break;
        doc.fontSize(b.fontSize ?? base);
        runs.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
          doc.font(Renderer.#face(r)).fillColor(r.color ?? b.color ?? '#111111');
          // pdfkit continues a line only when follow-up runs pass options alone (no position, no width).
          if (i === 0) doc.text(r.text, doc.page.margins.left, doc.y, { width, align: b.align ?? 'left', continued: runs.length > 1 });
          else doc.text(r.text, { continued: i < runs.length - 1 });
        });
        doc.font('sans').fontSize(base).fillColor('#111111').moveDown(0.6);
        break;
      }
      case 'keyValue': {
        const lw = width * (b.labelWidth ?? 0.35);
        const vw = width - lw - Renderer.PAD * 2;
        for (const item of b.items) {
          if (item.if && !TemplateText.test(item.if, data)) continue;
          const label = TemplateText.fill(item.label, [data]);
          const value = TemplateText.fill(item.value, [data]);
          doc.fontSize(base);
          const h = Math.max(doc.font('sans-bold').heightOfString(label, { width: lw }), doc.font('sans').heightOfString(value || ' ', { width: vw }));
          Renderer.#ensure(doc, h + 4);
          const y = doc.y;
          doc.font('sans-bold').fillColor('#444444').text(label, doc.page.margins.left, y, { width: lw });
          doc.font('sans').fillColor('#111111').text(value, doc.page.margins.left + lw + Renderer.PAD * 2, y, { width: vw });
          doc.y = y + h + 4;
        }
        doc.x = doc.page.margins.left;
        doc.moveDown(0.4);
        break;
      }
      case 'table': this.#table(ctx, b, width); break;
      case 'image': {
        const bytes = /** @type {Buffer} */ (ctx.images.get(ctx.path));
        const img = doc.openImage(bytes);
        let w = b.width ?? Math.min(img.width * 0.75, width);
        let h = b.height ?? (w * img.height) / img.width;
        if (b.width && !b.height) h = (b.width * img.height) / img.width;
        if (b.height && !b.width) w = (b.height * img.width) / img.height;
        w = Math.min(w, width);
        Renderer.#ensure(doc, h + 6);
        const x = Renderer.#x(doc, width, w, b.align);
        doc.image(img, x, doc.y, { width: w, height: h });
        doc.y += h + 6;
        doc.x = doc.page.margins.left;
        break;
      }
      case 'qr': {
        let qr;
        try { qr = new QrCode(TemplateText.fill(b.value, [data])); } catch (err) {
          if (err instanceof QrTooLongError) throw new RenderError('RENDER_FAILED', err.message, { block: ctx.path });
          throw err;
        }
        const size = Math.min(b.size ?? 96, width);
        const margin = 2;
        const cell = size / (qr.size + margin * 2);
        Renderer.#ensure(doc, size + 6);
        const x0 = Renderer.#x(doc, width, size, b.align);
        const y0 = doc.y;
        doc.save().rect(x0, y0, size, size).fill('#ffffff');
        for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.modules[r][c]) doc.rect(x0 + (c + margin) * cell, y0 + (r + margin) * cell, cell + 0.01, cell + 0.01);
        doc.fill('#000000').restore();
        doc.y = y0 + size + 6;
        doc.x = doc.page.margins.left;
        break;
      }
      case 'divider': {
        Renderer.#ensure(doc, 10);
        const y = doc.y + 4;
        doc.save().moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + width, y).lineWidth(0.6).strokeColor(b.color ?? '#cccccc').stroke().restore();
        doc.y = y + 6;
        break;
      }
      case 'spacer': {
        if (doc.y + b.height > doc.page.height - doc.page.margins.bottom) doc.addPage();
        else doc.y += b.height;
        break;
      }
      case 'pageBreak': doc.addPage(); break;
      default: throw new RenderError('RENDER_FAILED', `unknown block type ${b.type}`, { block: ctx.path });
    }
  }

  /** @param {any} ctx @param {Record<string, any>} b @param {number} width */
  #table(ctx, b, width) {
    const { doc, data, base } = ctx;
    const rows = TemplateText.get(data, b.rows);
    if (!Array.isArray(rows)) throw new RenderError('RENDER_FAILED', `"${b.rows}" is not an array in data`, { block: `${ctx.path}.rows` });
    if (rows.length > this.limits.maxTableRows) throw new RenderError('RENDER_FAILED', `table has more than MAX_TABLE_ROWS (${this.limits.maxTableRows}) rows`, { block: `${ctx.path}.rows` });
    const fs = b.fontSize ?? base * 0.9;
    const total = b.columns.reduce((/** @type {number} */ a, /** @type {any} */ c) => a + (c.width ?? 1), 0);
    const widths = b.columns.map((/** @type {any} */ c) => (width * (c.width ?? 1)) / total);
    const P = Renderer.PAD;
    const left = doc.page.margins.left;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const usable = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    /** @param {string[]} cells @param {string} font */
    const height = (cells, font) => {
      doc.font(font).fontSize(fs);
      return Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - P * 2 }))) + P * 2;
    };
    /** @param {string[]} cells @param {string} font @param {string|null} fill */
    const draw = (cells, font, fill) => {
      const h = height(cells, font);
      const y = doc.y;
      if (fill) doc.save().rect(left, y, width, h).fill(fill).restore();
      let x = left;
      doc.font(font).fontSize(fs).fillColor('#111111');
      cells.forEach((t, i) => { doc.text(t, x + P, y + P, { width: widths[i] - P * 2, align: b.columns[i].align ?? 'left', lineBreak: true }); x += widths[i]; });
      doc.save().moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.4).strokeColor('#dddddd').stroke().restore();
      doc.y = y + h;
    };
    const headers = b.columns.map((/** @type {any} */ c) => TemplateText.fill(c.header, [data]));
    const headH = height(headers, 'sans-bold');
    const header = () => draw(headers, 'sans-bold', '#eeeeee');
    if (doc.y + headH * 2 > bottom()) doc.addPage();
    header();
    if (!rows.length && b.empty) draw([TemplateText.fill(b.empty, [data]), ...headers.slice(1).map(() => '')], 'sans-italic', null);
    rows.forEach((row, n) => {
      if (n % 50 === 0) ctx.check();
      const cells = b.columns.map((/** @type {any} */ c) => TemplateText.fill(c.value, [row, data]));
      const h = height(cells, 'sans');
      if (h > usable - headH) throw new RenderError('RENDER_FAILED', `row ${n} is taller than a page`, { block: `${ctx.path}.rows[${n}]` });
      if (doc.y + h > bottom()) { doc.addPage(); header(); }
      draw(cells, 'sans', b.zebra && n % 2 === 1 ? '#f6f6f6' : null);
    });
    doc.x = left;
    doc.font('sans').fontSize(base).moveDown(0.8);
  }

  /** @param {{ bold?: boolean, italic?: boolean, mono?: boolean }} r */
  static #face(r) {
    if (r.mono) return 'mono';
    if (r.bold && r.italic) return 'sans-bolditalic';
    if (r.bold) return 'sans-bold';
    if (r.italic) return 'sans-italic';
    return 'sans';
  }

  /** Start a new page unless `h` points fit below the cursor. @param {Doc} doc @param {number} h */
  static #ensure(doc, h) {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
  }

  /** @param {Doc} doc @param {number} width @param {number} w @param {string|undefined} align */
  static #x(doc, width, w, align) {
    const left = doc.page.margins.left;
    return align === 'center' ? left + (width - w) / 2 : align === 'right' ? left + width - w : left;
  }

  /**
   * Header and footer on every page, with `{{page}}` / `{{pages}}`. Drawn last (pages are
   * buffered) into the margins, with the bottom margin lifted so pdfkit does not add a page.
   * @param {Doc} doc @param {Layout} layout @param {unknown} data @param {{ top: number, bottom: number }} m @param {number} base
   */
  static #bands(doc, layout, data, m, base) {
    if (!layout.header && !layout.footer) return;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const vars = { page: i - range.start + 1, pages: range.count };
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('sans').fontSize(base * 0.8).fillColor('#666666');
      if (layout.header) doc.text(TemplateText.fill(layout.header.text, [vars, data]), doc.page.margins.left, Math.max(12, m.top / 2 - base / 2), { width, align: layout.header.align ?? 'left', lineBreak: false });
      if (layout.footer) doc.text(TemplateText.fill(layout.footer.text, [vars, data]), doc.page.margins.left, doc.page.height - Math.max(12, m.bottom / 2 + base / 2), { width, align: layout.footer.align ?? 'center', lineBreak: false });
      doc.page.margins.bottom = keep;
    }
  }
}
