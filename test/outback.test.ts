import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { normalize } from '../lib/fitment';
import type { WsModification } from '../lib/wheelsize';

const fx = JSON.parse(readFileSync(new URL('./fixture-outback-2018.json', import.meta.url), 'utf8'));
// same merge rule as searchAllRegions: cdm first, de-duplicate by slug
const seen = new Map<string, WsModification>();
for (const m of [...fx.cdm, ...fx.usdm] as WsModification[]) if (!seen.has(m.slug!)) seen.set(m.slug!, m);
const merged = [...seen.values()];
assert.equal(merged.length, 2);

const cdmOnly = normalize(fx.cdm, 2018)!;
assert.ok(!cdmOnly.oe.some(o => o.tire === '225/65R17'), 'cdm alone misses the 17-inch size (why we merge usdm)');

const f = normalize(merged, 2018)!;
console.log(`${f.year} ${f.make} ${f.model} (${f.generation} ${f.generationYears}) ${f.boltPattern} CB${f.centreBoreMm} ${f.lugThread} ${f.torqueFtLb}ft·lb seat=${f.lugSeat}`);
for (const s of f.oe) console.log(`  ${s.stock ? 'OE ' : 'opt'} ${s.tire} ${s.loadIndex}${s.speedRating} ${s.rimDiameter}x${s.rimWidth} ET${s.offset} ${s.pressurePsi.front ?? '-'}psi  ${s.trims.join(', ')}`);
assert.equal(f.boltPattern, '5×114.3'); assert.equal(f.centreBoreMm, 56.1); assert.equal(f.lugThread, 'M12×1.25');
assert.equal(f.torqueFtLb, 89); assert.equal(f.lugSeat, 'conical'); assert.equal(f.generationYears, '2018–2022');
const oe17 = f.oe.find(o => o.stock && o.tire === '225/65R17')!;
assert.deepEqual([oe17.loadIndex, oe17.speedRating, oe17.rimWidth, oe17.offset], [102, 'H', 7, 55]);
const oe18 = f.oe.find(o => o.stock && o.tire === '225/60R18')!;
assert.deepEqual(oe18.trims, ['3.6i Limited', '3.6i Touring', '2.5i Premium', '2.5i Limited', '2.5i Touring']);
assert.equal(oe18.pressurePsi.front, 35); assert.equal(oe18.pressurePsi.rear, 33);
assert.equal(f.oe.filter(o => o.stock).length, 2);
assert.ok(f.oe.every(o => !o.staggeredRear));
assert.deepEqual(f.mixedSpecs, []);
console.log('REAL-DATA TEST PASSED');
