/** Response shapes. */
export class Views {
  /** @param {number} t */
  static iso(t) {
    return new Date(Number(t)).toISOString();
  }

  /** @param {import('../types.js').TemplateRow} t */
  static template(t) {
    return { name: t.name, description: t.description, latestVersion: Number(t.latest_version), createdBy: t.created_by, createdAt: Views.iso(t.created_at), updatedAt: Views.iso(t.updated_at) };
  }

  /** @param {Omit<import('../types.js').VersionRow, 'layout'> & { layout?: string }} v */
  static version(v) {
    return { version: Number(v.version), note: v.note, createdBy: v.created_by, createdAt: Views.iso(v.created_at), ...(v.layout !== undefined ? { layout: JSON.parse(v.layout) } : {}) };
  }
}
