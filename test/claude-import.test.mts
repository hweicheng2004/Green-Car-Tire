// Claude import: request shape, validation against the database rules, and the SQL it leads to.
// Uses a stand-in client (no API calls, no cost). The SQL runs in a real (embedded) Postgres with migration 003.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { cleanWithClaude, validateTire, validateWheel, toCleaned, outputSchema, MODEL, CHUNK_ROWS } from '../lib/claude-import';
import { toSql } from '../lib/inventory-clean';

// ---- validation mirrors the table constraints
assert.equal(validateTire({ size: 'P225/65R17', qty: 4 }).row?.tire_size, '225/65R17');
assert.equal(validateTire({ size: '31x10.50R15', qty: 4 }).row, null, 'flotation size rejected');
assert.equal(validateTire({ size: '225/65R17', qty: null }).row, null, 'qty required');
const t = validateTire({ size: 'LT245/75R16', qty: 4, price: 389.999, speed_rating: 's', load_index: 999, season: 'X', condition: 'used', tread_32nds: 40 }).row!;
assert.deepEqual([t.is_lt, t.price, t.speed_rating, t.load_index, t.season, t.tread_32nds], [true, 390, 'S', null, null, null], 'out-of-range values become null, never a DB error');
assert.equal(validateWheel({ diameter: 17, bolt_pattern: '5x4.5', qty: 4 }).row?.bolt_pattern, '5x114.3');
assert.equal(validateWheel({ diameter: 30, bolt_pattern: '5x114.3', qty: 4 }).row, null);
assert.equal(validateWheel({ diameter: 17, bolt_pattern: '5x114.3', qty: 4, condition: 'new', grade: 'A' }).row?.grade, null, 'grade only on used');
const schema = outputSchema('tires') as any;
assert.equal(schema.properties.rows.items.additionalProperties, false);
assert.deepEqual(schema.properties.rows.items.required, Object.keys(schema.properties.rows.items.properties), 'every field required (structured outputs)');

// ---- stand-in client: records each request, answers like Claude would
const headers = ['Item', 'Stock', 'Cost'];
const input = Array.from({ length: CHUNK_ROWS + 5 }, (_, i) => ({ sourceRow: i + 2, cells: [`225 65 17 Michelin X-Ice #${i}`, i === 3 ? 'four' : '4', '$916/set'] }));
input.push({ sourceRow: 99, cells: ['TOTAL', '', ''] });
const calls: any[] = [];
const fake = {
  beta: { messages: { stream(params: any) {
    calls.push(params);
    const rows = [...params.messages[0].content.matchAll(/^(\d+)\t(.*)$/gm)].map(m => {
      const r = Number(m[1]);
      if (r === 99) return { source_row: r, action: 'skip', note: 'Total row' };
      return { source_row: r, action: 'import', note: 'Price $916/set read as $229 per tire', size: '225/65R17', is_lt: false, brand: 'Michelin', model: 'X-Ice',
        season: 'W', condition: 'new', tread_32nds: null, load_index: 102, load_index_dual: null, speed_rating: 'T', is_xl: false, dot_year: null,
        qty: r === 5 ? null : 4, price: 229, location: null, notes: "O'Brien's set" };
    }).filter(x => x.source_row !== 10);   // Claude "forgets" one row
    return { finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ rows }) }],
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 800 } }) };
  } } },
};
const { cleaned, usage } = await cleanWithClaude('tires', headers, input, fake as any);

assert.equal(calls.length, 2, `${input.length} rows -> 2 chunks of up to ${CHUNK_ROWS}`);
const p = calls[0];
assert.equal(p.model, MODEL);
assert.equal(p.fallbacks, 'default'); assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
assert.equal(p.output_config.format.type, 'json_schema');
assert.equal(p.system[0].cache_control.type, 'ephemeral', 'instructions cached across chunks');
assert.equal(p.system[0].text, calls[1].system[0].text, 'identical system prompt per chunk, so the cache hits');
assert.ok(!('thinking' in p) && !('temperature' in p), 'no thinking/sampling params Opus 5.5 rejects');
assert.deepEqual(usage, { input: 2000, output: 1000, cacheRead: 1600, requests: 2 });

assert.equal(cleaned.length, input.length, 'one result per row, in sheet order');
assert.deepEqual(cleaned.map(c => c.sourceRow), input.map(r => r.sourceRow));
const at = (r: number) => cleaned.find(c => c.sourceRow === r)!;
assert.equal((at(2).row as any).tire_size, '225/65R17'); assert.match(at(2).issues[0].msg, /Claude: Price/);
assert.equal(at(5).row, null, 'Claude gave no qty: rejected, not guessed');
assert.equal(at(10).row, null); assert.match(at(10).issues[0].msg, /returned nothing/);
assert.equal(at(99).skipped, true);

// ---- the SQL runs against the real schema, quotes are escaped
const db = new PGlite();
await db.exec(readFileSync(new URL('../supabase/migrations/003_inventory.sql', import.meta.url), 'utf8'));
await db.exec(toSql('tires', "Bob's sheet", cleaned));
const n = await db.query<{ n: number; notes: string }>(`select count(*)::int n, max(notes) notes from tires where source = 'Bob''s sheet'`);
assert.equal(n.rows[0].n, input.length - 3);
assert.equal(n.rows[0].notes, "O'Brien's set");

// ---- a failed chunk keeps the other chunk's rows
let k = 0;
const flaky = { beta: { messages: { stream: (params: any) => (k++ === 0 ? { finalMessage: async () => { throw new Error('overloaded'); } } : fake.beta.messages.stream(params)) } } };
const part = await cleanWithClaude('tires', headers, input, flaky as any);
assert.equal(part.cleaned.filter(c => c.row).length, 5, 'second chunk (rows 62-66) still imported');
assert.ok(part.cleaned.slice(0, CHUNK_ROWS).every(c => !c.row && /overloaded/.test(c.issues[0].msg) && Object.keys(c.raw).length), 'failed rows keep their original cells');
await assert.rejects(cleanWithClaude('tires', headers, Array.from({ length: 2000 }, (_, i) => ({ sourceRow: i, cells: [] })), fake as any), /at most/);

console.log('CLAUDE IMPORT TEST PASSED');
