import { LayoutSchema } from '../domain/layout-schema.js';

/** JSON Schemas for the HTTP surface. */
export class Schemas {
  static name = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' };
  static note = { type: 'string', maxLength: 500 };
  static description = { type: 'string', maxLength: 500 };
  static data = { type: 'object' };

  static create = { type: 'object', additionalProperties: false, required: ['name', 'layout'], properties: { name: Schemas.name, description: Schemas.description, layout: LayoutSchema.layout, note: Schemas.note } };
  static patch = { type: 'object', additionalProperties: false, required: ['description'], properties: { description: Schemas.description } };
  static version = { type: 'object', additionalProperties: false, required: ['layout'], properties: { layout: LayoutSchema.layout, note: Schemas.note } };
  static render = {
    type: 'object', additionalProperties: false, required: ['template'],
    properties: { template: Schemas.name, version: { type: 'integer', minimum: 1 }, data: Schemas.data, filename: { type: 'string', minLength: 1, maxLength: 120 }, store: { type: 'boolean' } },
  };
  static preview = { type: 'object', additionalProperties: false, required: ['layout'], properties: { layout: LayoutSchema.layout, data: Schemas.data } };
  static nameParams = { type: 'object', properties: { name: Schemas.name }, required: ['name'] };
  static versionParams = { type: 'object', properties: { name: Schemas.name, version: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' } }, required: ['name', 'version'] };
}
