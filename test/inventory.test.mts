import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import * as C from '../lib/inventory-clean';
import { SAMPLE_TIRES, SAMPLE_WHEELS } from '../lib/sample-sheets';

// ---- unit checks on the parsers
const sz = (s: string) => C.parseTireSize(s)?.size ?? null;
for (const s of ['225/65R17', '225 65 17', '2256517', 'P225/65ZR17', '225-65-17', '225/65/17', '225/65 R17', 'LT225/65R17']) assert.equal(sz(s), '225/65R17', s);
assert.equal(sz('31x10.50R15'), null);
assert.equal(sz('5x114.3'), null);
assert.deepEqual(C.parseTireSize('LT245/75R16 120/116S'), { size: '245/75R16', width: 245, aspect: 75, rim: 16, isLt: true, loadIndex: 120, loadIndexDual: 116, speedRating: 'S' });
assert.equal(C.parseTireSize('225/60R18 104R XL')!.xl, true);
assert.deepEqual(C.parseLoadSpeed('97H XL'), { loadIndex: 97, loadIndexDual: undefined, speedRating: 'H' });
assert.equal(C.parseDotYear('2525', 2026), 2025); assert.equal(C.parseDotYear('1519', 2026), 2019);
assert.equal(C.parseDotYear('2022', 2026), 2022); assert.equal(C.parseDotYear('DOT 4721', 2026), 2021); assert.equal(C.parseDotYear('0525', 2026), 2025);
assert.equal(C.parseTread('7/32'), 7); assert.equal(C.parseTread('6mm'), 8); assert.equal(C.parseTread('new'), 0);
assert.deepEqual(C.parsePrice('$300/set'), { price: 75, perSet: true }); assert.deepEqual(C.parsePrice('$1,100.50'), { price: 1100.5, perSet: false });
assert.deepEqual(C.parseQty('four'), { qty: 0, ok: false }); assert.deepEqual(C.parseQty(''), { qty: 0, ok: true });
assert.equal(C.parseSeason('snow'), 'W'); assert.equal(C.parseSeason('all weather'), 'AW'); assert.equal(C.parseSeason('A/S'), 'AS');
assert.equal(C.parseSeason('CrossClimate2 SUV'), 'AW'); assert.equal(C.parseSeason('X-Ice Snow'), 'W');
assert.deepEqual(C.parseBoltPatterns('5x100/5x114.3'), ['5x100', '5x114.3']);
assert.deepEqual(C.parseBoltPatterns('6x5.5'), ['6x139.7']); assert.deepEqual(C.parseBoltPatterns('5x4.5'), ['5x114.3']);
assert.deepEqual(C.parseBoltPatterns('5-114.3'), ['5x114.3']); assert.deepEqual(C.parseBoltPatterns('17x7'), []);
assert.deepEqual(C.parseWheelSize('7Jx18'), { diameter: 18, width: 7 }); assert.deepEqual(C.parseWheelSize('16 x 6.5'), { diameter: 16, width: 6.5 });
assert.equal(C.parseWheelSize('5x114.3'), null);
assert.equal(C.parseOffset('ET39'), 39); assert.equal(C.parseOffset('+45'), 45); assert.equal(C.parseOffset('-12'), -12);

// ---- whole tire sheet
const run = (text: string) => {
  const rows = C.parseDelimited(text);
  const h = C.findHeaderRow(rows);
  const headers = rows[h], body = rows.slice(h + 1);
  const kind = C.detectKind(headers, body);
  const map = C.autoMap(headers, kind);
  const cleaned = C.cleanAll(kind, headers, body, map).map(c => ({ ...c, sourceRow: c.sourceRow + h }));
  return { h, headers, kind, map, cleaned };
};
const t = run(SAMPLE_TIRES);
assert.equal(t.h, 1, 'title row skipped, header found on row 2');
assert.equal(t.kind, 'tires');
for (const f of ['size', 'brand', 'model', 'season', 'condition', 'tread', 'loadSpeed', 'dot', 'qty', 'price', 'location', 'notes']) assert.ok(t.map[f] !== undefined, `mapped ${f}`);
const good = t.cleaned.filter(c => c.row), bad = t.cleaned.filter(c => !c.row && !c.skipped), skipped = t.cleaned.filter(c => c.skipped);
console.log(`tires: ${good.length} clean, ${bad.length} rejected, ${skipped.length} skipped`);
for (const c of bad) console.log(`  row ${c.sourceRow}: ${c.issues.map(i => i.msg).join('; ')}`);
assert.equal(good.length, 11); assert.equal(bad.length, 2); assert.equal(skipped.length, 2);
assert.deepEqual(bad.map(b => b.sourceRow), [16, 17], 'flotation size and "four" qty rejected with their sheet row numbers');
const byRow = (n: number) => t.cleaned.find(c => c.sourceRow === n)!.row as C.TireRow;
assert.deepEqual([byRow(3).tire_size, byRow(3).season, byRow(3).condition, byRow(3).load_index, byRow(3).speed_rating, byRow(3).dot_year, byRow(3).price],
  ['225/65R17', 'W', 'new', 102, 'T', 2025, 229]);
assert.deepEqual([byRow(6).condition, byRow(6).tread_32nds, byRow(6).price, byRow(6).season], ['used', 7, 75, 'AS']);
assert.equal(byRow(7).season, 'W', 'blank season guessed from "Arctic"');
assert.deepEqual([byRow(8).load_index, byRow(8).speed_rating, byRow(8).is_xl], [104, 'R', true], 'load/speed/XL read from the size cell');
assert.equal(byRow(9).qty, 0, 'blank qty = 0, kept so the counter can show "order it"');
assert.deepEqual([byRow(10).is_lt, byRow(10).load_index, byRow(10).load_index_dual], [true, 120, 116]);
assert.deepEqual([byRow(15).condition, byRow(15).tread_32nds, byRow(15).is_xl, byRow(15).load_index], ['used', 9, true, 97]);
assert.ok(t.cleaned.find(c => c.sourceRow === 12)!.issues.some(i => /3\/32/.test(i.msg)), 'low tread warned');

// ---- whole wheel sheet
const w = run(SAMPLE_WHEELS);
assert.equal(w.kind, 'wheels');
const wg = w.cleaned.filter(c => c.row), wb = w.cleaned.filter(c => !c.row && !c.skipped);
console.log(`wheels: ${wg.length} clean, ${wb.length} rejected`);
for (const c of wb) console.log(`  row ${c.sourceRow}: ${c.issues.map(i => i.msg).join('; ')}`);
const wr = (n: number) => w.cleaned.find(c => c.sourceRow === n)!.row as C.WheelRow;
assert.deepEqual([wr(2).wheel_type, wr(2).diameter, wr(2).width, wr(2).wheel_offset, wr(2).bolt_pattern, wr(2).center_bore, wr(2).condition], ['steel', 17, 7, 39, '5x114.3', 60.1, 'new']);
assert.deepEqual([wr(4).wheel_type, wr(4).grade, wr(4).condition], ['alloy', 'C', 'used']);
assert.deepEqual([wr(5).diameter, wr(5).width], [18, 7]);
assert.deepEqual([wr(6).bolt_pattern, wr(6).bolt_pattern_alt], ['5x100', '5x114.3']);
assert.equal(wr(7).price, 275);
assert.deepEqual([wr(8).bolt_pattern, wr(8).wheel_type], ['6x139.7', 'steel']);
assert.deepEqual(wb.map(b => b.sourceRow), [9], 'Jeep row with no size is rejected');

// ---- generated SQL runs against the real schema, twice (re-import replaces, never duplicates)
const db = new PGlite();
await db.exec(readFileSync(new URL('../supabase/migrations/003_inventory.sql', import.meta.url), 'utf8'));
const tsql = C.toSql('tires', 'Tires tab', t.cleaned), wsql = C.toSql('wheels', 'Wheels tab', w.cleaned);
await db.exec(tsql); await db.exec(tsql); await db.exec(wsql);
const n = await db.query<{ tires: number; qty: number; wheels: number }>(
  `select (select count(*)::int from tires) tires, (select sum(qty)::int from tires) qty, (select count(*)::int from wheels) wheels`);
assert.deepEqual(n.rows[0], { tires: 11, qty: 45, wheels: 7 });
const r = await db.query<{ raw: Record<string, string>; source_row: number }>(`select raw, source_row from tires where location = 'Used U-11'`);
assert.equal(r.rows[0].source_row, 6); assert.equal(r.rows[0].raw.Notes, 'light plug in one');
// quotes in data can't break the SQL
const evil = C.toSql('tires', "O'Neil's tab", [{ sourceRow: 2, raw: { x: "it's" }, issues: [], row: { ...byRow(3), notes: "'); drop table tires; --" } }]);
await db.exec(evil);
assert.equal((await db.query<{ n: number }>(`select count(*)::int n from tires`)).rows[0].n, 12);
// counter query: what's on the shelf for a 225/65R17, by season
const shelf = await db.query(`select season, condition, sum(qty)::int qty from tires where tire_size='225/65R17' and qty>0 group by 1,2 order by 1,2`);
console.table(shelf.rows);
console.log('INVENTORY TEST PASSED');
