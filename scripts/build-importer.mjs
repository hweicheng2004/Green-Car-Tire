// Builds importer/dist/sheet-import.html: the page with lib/inventory-clean.ts bundled in.
// Run: node scripts/build-importer.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const entry = `export * as clean from './lib/inventory-clean'; export * as samples from './lib/sample-sheets';`;
const out = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'iife', globalName: 'GCT', target: 'es2019', minify: true, write: false,
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const schema = readFileSync('supabase/migrations/003_inventory.sql', 'utf8');
const page = readFileSync('importer/page.html', 'utf8')
  .replace('/*__BUNDLE__*/', () => js)
  .replace('/*__SCHEMA__*/""', () => JSON.stringify(schema).replace(/<\//g, '<\\/'));
mkdirSync('importer/dist', { recursive: true });
writeFileSync('importer/dist/sheet-import.html', page);
console.log(`importer/dist/sheet-import.html  ${(page.length / 1024).toFixed(0)} KB`);
