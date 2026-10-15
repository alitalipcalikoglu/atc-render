import { RenderService } from '../domain/render-service.js';

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

  /** @param {import('../store/job-store.js').JobRow} j */
  static job(j) {
    return {
      id: j.id, status: j.status, template: j.template, version: Number(j.version), filename: RenderService.filename(j.filename), store: j.store === 1, createdBy: j.actor,
      createdAt: Views.iso(j.created_at), startedAt: j.started_at === null ? null : Views.iso(j.started_at), finishedAt: j.finished_at === null ? null : Views.iso(j.finished_at),
      pages: j.pages === null ? null : Number(j.pages), bytes: j.bytes === null ? null : Number(j.bytes),
      error: j.error_code ? { code: j.error_code, message: j.error_message ?? '' } : null,
      result: j.status !== 'succeeded' ? null : j.file_id
        ? { fileId: j.file_id, url: j.url, expiresAt: j.url_expires_at === null ? null : Views.iso(j.url_expires_at) }
        : { download: `/v1/renders/${j.id}/pdf` },
    };
  }

  /** @param {Omit<import('../types.js').VersionRow, 'layout'> & { layout?: string }} v */
  static version(v) {
    return { version: Number(v.version), note: v.note, createdBy: v.created_by, createdAt: Views.iso(v.created_at), ...(v.layout !== undefined ? { layout: JSON.parse(v.layout) } : {}) };
  }
}
