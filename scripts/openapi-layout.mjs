// Writes the enforced layout JSON Schema into openapi.yaml (components.schemas.Layout), so the
// documented contract can never drift from validation. Run after changing src/domain/layout-schema.js:
//   node scripts/openapi-layout.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { LayoutSchema } from '../src/domain/layout-schema.js';

const file = new URL('../openapi.yaml', import.meta.url);
const doc = readFileSync(file, 'utf8');
const next = doc.replace(/^ {4}Layout: .*$/m, `    Layout: ${JSON.stringify(LayoutSchema.layout)}`);
if (next === doc) console.log('openapi.yaml Layout already current');
else { writeFileSync(file, next); console.log('openapi.yaml Layout updated'); }
