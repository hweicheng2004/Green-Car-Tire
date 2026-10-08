// Runs both migrations in a real (embedded) Postgres and exercises the save + log path end to end.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { normalize } from '../lib/fitment';
import { toRow } from '../lib/search-log';
import type { WsModification } from '../lib/wheelsize';

const sql = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
const db = new PGlite();

// Supabase has these roles; plain Postgres doesn't. RLS statements need nothing else.
await db.exec(sql('001_wheelsize_cache.sql'));

// A fitment cached BEFORE migration 002 exists, to prove the backfill works.
const fx = JSON.parse(readFileSync(new URL('./fixture-outback-2018.json', import.meta.url), 'utf8'));
const seen = new Map<string, WsModification>();
for (const m of [...fx.cdm, ...fx.usdm] as WsModification[]) if (!seen.has(m.slug!)) seen.set(m.slug!, m);
const fit = normalize([...seen.values()], 2018)!;
await db.query(`insert into vehicle_fitment (make_slug, model_slug, year, region, data) values ($1,$2,$3,$4,$5)`,
  ['subaru', 'outback', 2018, 'cdm+usdm', JSON.stringify(fit)]);

await db.exec(sql('002_search_log.sql'));
const back = await db.query<{ n: number }>(`select count(*)::int n from fitment_oe_sizes`);
assert.equal(back.rows[0].n, fit.oe.length, 'backfill wrote one row per size');

// Re-saving the same vehicle (what the API route does) replaces rows, never duplicates.
const again = await db.query<{ n: number }>(`select sync_fitment_oe_sizes('subaru','outback',2018,'cdm+usdm') n`);
assert.equal(again.rows[0].n, fit.oe.length);
const sizes = await db.query<{ tire_size: string; stock: boolean; load_index: number; rim_offset: string; trims: string[] }>(
  `select tire_size, stock, load_index, rim_offset, trims from fitment_oe_sizes where tire_size = '225/65R17'`);
assert.equal(sizes.rows.length, 1);
assert.deepEqual([sizes.rows[0].stock, sizes.rows[0].load_index, Number(sizes.rows[0].rim_offset)], [true, 102, 55]);
assert.deepEqual(sizes.rows[0].trims, ['2.5i Premium', '2.5i Limited', '2.5i Touring']);

// Search log: four realistic counter searches.
const searches = [
  { kind: 'vehicle', query: '18 outback', year: 2018, makeSlug: 'subaru', modelSlug: 'outback', tireSize: '225/65R17',
    oeSizes: ['225/65R17', '225/60R18'], exactInStock: 20, newInStock: 18, altInStock: 0, wheelsInStock: 3, fitmentSource: 'api' },
  { kind: 'vehicle', query: '20 crv', year: 2020, makeSlug: 'honda', modelSlug: 'cr-v', tireSize: '235/65R17',
    exactInStock: 0, newInStock: 0, altInStock: 10, wheelsInStock: 8, fitmentSource: 'cache' },
  { kind: 'size', query: '235 65 17', tireSize: '235/65R17' },
  { kind: 'size', query: '205 60 16', tireSize: '205/60R16', exactInStock: 2, newInStock: 0 },
  { kind: 'vehicle', query: '18 zzz' },
];
const outcomes: string[] = [];
for (const s of searches) {
  const r = toRow(s); assert.ok('row' in r, JSON.stringify(r));
  const cols = Object.keys(r.row);
  const res = await db.query<{ outcome: string }>(
    `insert into counter_searches (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning outcome`,
    cols.map(c => r.row[c]));
  outcomes.push(res.rows[0].outcome);
}
assert.deepEqual(outcomes, ['in_stock', 'alternate_only', 'special_order', 'used_only', 'no_match']);

const missed = await db.query(`select tire_size, searches, special_orders, sold_alternate_maybe, used_only from missed_demand_30d`);
console.table(missed.rows);
assert.deepEqual(missed.rows[0], { tire_size: '235/65R17', searches: 2, special_orders: 1, sold_alternate_maybe: 1, used_only: 0 });

const top = await db.query(`select year, make_slug, model_slug, searches, had_stock from top_vehicles_30d`);
console.table(top.rows);
assert.equal(top.rows.length, 2);

// Bad input is rejected, not stored.
assert.ok('error' in toRow({ kind: 'nope', query: 'x' }));
assert.ok('error' in toRow({ kind: 'size' }));
const junk = toRow({ kind: 'size', query: '<script>', tireSize: "225/65R17'; drop table x", exactInStock: -5 });
assert.ok('row' in junk && junk.row.tire_size === null && junk.row.exact_in_stock === 0 && junk.row.outcome === 'no_match');

console.log('DB TEST PASSED');
