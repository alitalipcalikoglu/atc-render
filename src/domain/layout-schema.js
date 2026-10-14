/**
 * JSON Schema of a layout. Used as the request-body schema wherever a layout is accepted, so an
 * invalid layout is a 400 whose `details[].path` names the offending block (e.g. `/layout/blocks/3/level`).
 */
export class LayoutSchema {
  static PATH = '^!?[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z0-9_$]+){0,15}$';
  static text = { type: 'string', maxLength: 10_000 };
  static align = { type: 'string', enum: ['left', 'center', 'right'] };
  static color = { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' };
  static cond = { type: 'string', pattern: LayoutSchema.PATH, description: 'Render the block only when this data path is truthy; prefix ! to negate.' };

  /** @param {string} type @param {string[]} required @param {Record<string, object>} props */
  static block(type, required, props) {
    return { type: 'object', additionalProperties: false, required: ['type', ...required], properties: { type: { const: type }, if: LayoutSchema.cond, ...props } };
  }

  static run = {
    type: 'object', additionalProperties: false, required: ['text'],
    properties: { text: LayoutSchema.text, bold: { type: 'boolean' }, italic: { type: 'boolean' }, mono: { type: 'boolean' }, color: LayoutSchema.color },
  };

  static blocks = [
    LayoutSchema.block('heading', ['text'], { level: { type: 'integer', enum: [1, 2, 3] }, text: LayoutSchema.text, align: LayoutSchema.align, color: LayoutSchema.color }),
    LayoutSchema.block('text', [], {
      text: LayoutSchema.text,
      runs: { type: 'array', minItems: 1, maxItems: 200, items: LayoutSchema.run },
      align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
      fontSize: { type: 'number', minimum: 6, maximum: 36 },
      color: LayoutSchema.color,
    }),
    LayoutSchema.block('keyValue', ['items'], {
      items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: LayoutSchema.text, value: LayoutSchema.text, if: LayoutSchema.cond } } },
      labelWidth: { type: 'number', minimum: 0.1, maximum: 0.7 },
    }),
    LayoutSchema.block('table', ['rows', 'columns'], {
      rows: { type: 'string', pattern: '^[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z0-9_$]+){0,15}$', description: 'Data path of an array; each element is one row.' },
      columns: {
        type: 'array', minItems: 1, maxItems: 20,
        items: { type: 'object', additionalProperties: false, required: ['header', 'value'], properties: { header: LayoutSchema.text, value: LayoutSchema.text, width: { type: 'number', minimum: 0.1, maximum: 100 }, align: LayoutSchema.align } },
      },
      zebra: { type: 'boolean' },
      fontSize: { type: 'number', minimum: 6, maximum: 18 },
      empty: LayoutSchema.text,
    }),
    LayoutSchema.block('image', [], {
      fileId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' },
      data: { type: 'string', minLength: 8, maxLength: 4_000_000, pattern: '^[A-Za-z0-9+/=\\s]+$' },
      width: { type: 'number', minimum: 8, maximum: 2_000 },
      height: { type: 'number', minimum: 8, maximum: 2_000 },
      align: LayoutSchema.align,
    }),
    LayoutSchema.block('qr', ['value'], { value: { type: 'string', minLength: 1, maxLength: 2_000 }, size: { type: 'number', minimum: 40, maximum: 400 }, align: LayoutSchema.align }),
    LayoutSchema.block('divider', [], { color: LayoutSchema.color }),
    LayoutSchema.block('spacer', ['height'], { height: { type: 'number', minimum: 1, maximum: 800 } }),
    LayoutSchema.block('pageBreak', [], {}),
  ];

  static margin = { type: 'number', minimum: 18, maximum: 144 };
  static band = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 500 }, align: LayoutSchema.align } };

  static {
    const [, text, , , image] = LayoutSchema.blocks;
    Object.assign(text, { anyOf: [{ required: ['text'] }, { required: ['runs'] }] });
    Object.assign(image, { oneOf: [{ required: ['fileId'] }, { required: ['data'] }] });
  }

  static layout = {
    type: 'object', additionalProperties: false, required: ['blocks'],
    properties: {
      page: {
        type: 'object', additionalProperties: false,
        properties: {
          size: { type: 'string', enum: ['A4', 'Letter', 'A5'] },
          orientation: { type: 'string', enum: ['portrait', 'landscape'] },
          margins: { type: 'object', additionalProperties: false, properties: { top: LayoutSchema.margin, right: LayoutSchema.margin, bottom: LayoutSchema.margin, left: LayoutSchema.margin } },
          fontSize: { type: 'number', minimum: 6, maximum: 18 },
        },
      },
      header: LayoutSchema.band,
      footer: LayoutSchema.band,
      blocks: { type: 'array', minItems: 1, maxItems: 1_000, items: { oneOf: LayoutSchema.blocks } },
    },
  };
}
