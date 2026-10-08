// supabase/setup-all.sql is what people paste into Supabase: it must be current, and safe to run twice.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { isMissingTable, explainDbError } from '../lib/db-errors';

const all = readFileSync(new URL('../supabase/setup-all.sql', import.meta.url), 'utf8');
for (const f of readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql'))) {
  const body = readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8').trimEnd();
  assert.ok(all.includes(body), `setup-all.sql is out of date with ${f}: run npm run setup-sql`);
}

const db = new PGlite();
await db.exec(all);
await db.exec(`insert into tires (tire_size, section_width, aspect_ratio, rim_diameter, condition, qty, source) values ('225/65R17',225,65,17,'new',4,'x')`);
await db.exec(all);   // second paste: no errors, data kept, settings not duplicated
const n = await db.query<{ t: number; s: number }>(`select (select count(*)::int from tires) t, (select count(*)::int from shop_settings) s`);
assert.deepEqual(n.rows[0], { t: 1, s: 2 });
for (const t of ['vehicle_models', 'vehicle_fitment', 'wheelsize_usage', 'fitment_oe_sizes', 'counter_searches', 'tires', 'wheels', 'shop_settings', 'inventory_syncs']) {
  await db.query(`select 1 from ${t} limit 1`);
}

// The exact error from a Supabase project with no tables yet.
const raw = { code: 'PGRST205', message: "Could not find the table 'public.tires' in the schema cache" };
assert.ok(isMissingTable(raw));
assert.match(explainDbError(raw), /setup-all\.sql/);
assert.equal(explainDbError({ code: '23505', message: 'duplicate key' }), 'duplicate key');
console.log('SETUP SQL TEST PASSED');
