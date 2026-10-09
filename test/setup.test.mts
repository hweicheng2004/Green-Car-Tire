// /setup: status checks and loading the sample CSVs (the files offered for download) into a real embedded Postgres.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { setupStatus, loadSheet } from '../lib/setup';
import { parseDelimited } from '../lib/inventory-clean';

const pg = new PGlite();
await pg.exec(readFileSync(new URL('../supabase/setup-all.sql', import.meta.url), 'utf8'));

// Minimal stand-in for the Supabase client: count queries, the replace_inventory RPC, the sync log insert.
let dropped = new Set<string>();
const db: any = {
  from: (t: string) => ({
    select: () => ({ limit: async () => dropped.has(t)
      ? { count: null, status: 404, error: { code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` } }
      : { count: (await pg.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0].n, status: 200, error: null } }),
    insert: async (r: any) => { await pg.query(`insert into ${t} (trigger, kind, tabs, status, rows_synced, qty_on_hand, rejected, warnings, message) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [r.trigger, r.kind, r.tabs, r.status, r.rows_synced, r.qty_on_hand, r.rejected, r.warnings, r.message]); return { error: null }; },
  }),
  rpc: async (fn: string, a: any) => ({ data: (await pg.query<{ n: number }>(`select ${fn}($1, $2::jsonb) n`, [a.p_kind, JSON.stringify(a.p_rows)])).rows[0].n, error: null }),
};

// Status: nothing connected, then tables missing, then ready and empty.
const none = await setupStatus(null, {});
assert.deepEqual([none.supabase, none.missingTables.length, none.anthropic], [false, 8, false]);
dropped = new Set(['tires', 'inventory_syncs']);
const half = await setupStatus(db, { ANTHROPIC_API_KEY: 'x' });
assert.deepEqual([half.supabase, half.missingTables, half.anthropic], [true, ['tires', 'inventory_syncs'], true]);
dropped = new Set();
const empty = await setupStatus(db, {});
assert.deepEqual([empty.missingTables, empty.tires, empty.wheels], [[], 0, 0]);

// The sample files: preview first (nothing written), then load.
const csv = (f: string) => parseDelimited(readFileSync(new URL(`../public/samples/${f}`, import.meta.url), 'utf8'));
const tires = csv('demo-tires.csv'), wheels = csv('demo-wheels.csv');
const dry = await loadSheet(db, 'tires', 'demo-tires', tires, true);
assert.deepEqual([dry.loaded, dry.rows, dry.qty, dry.rejected, dry.block], [false, 22, 89, 2, null]);
assert.deepEqual(dry.problems.map(p => p.row), [22, 23], 'bad rows reported by sheet row number');
assert.equal((await setupStatus(db, {})).tires, 0, 'preview writes nothing');
const t = await loadSheet(db, 'tires', 'demo-tires', tires, false);
const w = await loadSheet(db, 'wheels', 'demo-wheels', wheels, false);
assert.deepEqual([t.loaded, w.loaded, w.rows], [true, true, 11]);
const after = await setupStatus(db, {});
assert.deepEqual([after.tires, after.wheels], [22, 11]);
assert.equal((await pg.query<{ n: number }>(`select count(*)::int n from inventory_syncs where status = 'ok' and message = 'Loaded from /setup'`)).rows[0].n, 2, 'logged like a sync');

// Loading again replaces, never duplicates; a sheet with no size column is refused.
await loadSheet(db, 'tires', 'demo-tires', tires, false);
assert.equal((await setupStatus(db, {})).tires, 22);
const bad = await loadSheet(db, 'tires', 'x', [['Name', 'Qty'], ['Thing', '4']], false);
assert.equal(bad.loaded, false); assert.ok(bad.block, 'refused with a reason');
assert.equal((await setupStatus(db, {})).tires, 22, 'a refused load leaves stock alone');

// ---- make/model list from Wheel-Size (the /setup button): every market, every make, counted against the quota
const { seedModels } = await import('../lib/seed-models');
process.env.WHEELSIZE_API_KEY = 'test'; process.env.WHEELSIZE_REGIONS = 'cdm,usdm';
const prevFetch = globalThis.fetch; const seen: string[] = [];
globalThis.fetch = (async (u: URL) => {
  const url = new URL(String(u)); seen.push(url.pathname + '?' + url.searchParams.get('region'));
  const data = url.pathname === '/v2/makes/' ? [{ slug: 'mazda', name: 'Mazda' }, { slug: 'honda', name: 'Honda' }]
    : url.searchParams.get('make') === 'mazda' ? [{ slug: 'cx-5', name: 'CX-5' }, { slug: 'mx-5', name: 'MX-5' }] : [{ slug: 'civic', name: 'Civic' }];
  return new Response(JSON.stringify({ data }));
}) as any;
let hitCount = 0; const upserts: any[] = [];
const seedDb: any = { rpc: async () => { hitCount++; return { data: hitCount, error: null }; },
  from: () => ({ upsert: async (rows: any[]) => { upserts.push(...rows); return { error: null }; } }) };
const sr = await seedModels(seedDb);
globalThis.fetch = prevFetch;
assert.deepEqual([sr.makes, sr.models, sr.hits, hitCount], [4, 6, 6, 6], '2 markets x (1 makes call + 2 makes)');
assert.ok(upserts.some(r => r.make_slug === 'mazda' && r.model_slug === 'cx-5' && r.region === 'usdm'));
assert.equal(seen.filter(x => x.startsWith('/v2/makes/')).length, 2);
console.log('SETUP TEST PASSED');
