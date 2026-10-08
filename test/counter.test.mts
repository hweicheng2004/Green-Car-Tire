// Counter data: demo mode (no accounts) and the mappers live mode uses.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { isDemo, demoVehicle, demoOeOn, demoInventory, demoIssueSheet } from '../lib/demo';
import { fitmentToCounter, feesFromSettings, toCounterWheel, DEFAULT_FEES } from '../lib/counter-data';
import { normalize } from '../lib/fitment';
import type { WsModification } from '../lib/wheelsize';

// ---- when demo mode is on
assert.equal(isDemo({}), true, 'no Supabase = demo');
assert.equal(isDemo({ SUPABASE_URL: 'https://x.supabase.co' }), false);
assert.equal(isDemo({ SUPABASE_URL: 'https://x.supabase.co', DEMO_MODE: '1' }), true, 'forced on');
assert.equal(isDemo({ DEMO_MODE: '0' }), false, 'forced off');

// ---- demo vehicles: same shorthand the counter accepts
const veh = (q: string) => { const r = demoVehicle(q); assert.ok('vehicle' in r, q); return r.vehicle; };
assert.deepEqual([veh('18 outback').year, veh('18 outback').gen, veh('18 outback').oe[0][0]], [2018, '2015–2019', '225/65R17']);
assert.equal(veh('2019 honda civic').model, 'Civic');
assert.equal(veh('20 crv').model, 'CR-V');
assert.equal(veh('17 f150').bolt, '6×135');
assert.equal(veh('f150 17').year, 2017);
assert.deepEqual([veh('outback').year, veh('outback').assumed], [2024, true], 'no year: latest generation');
const miss = demoVehicle('2009 civic'); assert.ok('miss' in miss && miss.miss.label === 'Honda Civic');
assert.ok('none' in demoVehicle('zzz')); assert.ok('none' in demoVehicle(''));
assert.deepEqual(demoOeOn('225/65R17').map(v => v.label).slice(0, 2), ['2015–2019 Subaru Outback', '2020–2024 Subaru Outback']);
assert.ok(demoOeOn('225/65R17').every(v => 'vehicle' in demoVehicle(v.q)), '"OE on" buttons search a vehicle that resolves');

// ---- demo inventory = the demo sheet through the real cleaner
const inv = demoInventory();
assert.equal(inv.mode, 'demo');
assert.equal(inv.tires.length, 20); assert.equal(inv.wheels.length, 11);
assert.equal(inv.tires.reduce((n, t) => n + t.qty, 0), 85);
assert.ok(!inv.tires.some(t => t.size.startsWith('31x')), 'rejected rows stay off the counter');
const nokian = inv.tires.find(t => t.brand === 'Nokian' && t.model === 'One')!;
assert.deepEqual([nokian.size, nokian.price, nokian.season], ['225/65R17', 259, 'AS'], 'messy "225 65 17" and "$1,036/set" cleaned');
const usedTire = inv.tires.find(t => t.model === 'CrossContact LX25')!;
assert.deepEqual([usedTire.used, usedTire.tread], [true, 7]);
const dual = inv.wheels.find(w => w.pcds.length === 2)!;
assert.deepEqual(dual.pcds, ['5×100', '5×114.3'], 'dual-drilled wheel matches both, in the × format fitment uses');
assert.equal(new Set(inv.tires.map(t => t.id)).size, inv.tires.length, 'unique ids');
for (const v of [...inv.tries.vehicles]) assert.ok('vehicle' in demoVehicle(v), `Try button "${v}" resolves`);
const { sheet } = demoIssueSheet();
assert.deepEqual(sheet.filter(r => r[2] === 'Not synced').map(r => r[1]), ['23', '24', '14']);

// ---- live mappers
const fx = JSON.parse(readFileSync(new URL('./fixture-outback-2018.json', import.meta.url), 'utf8'));
const seen = new Map<string, WsModification>();
for (const m of [...fx.cdm, ...fx.usdm] as WsModification[]) if (!seen.has(m.slug!)) seen.set(m.slug!, m);
const cv = fitmentToCounter(normalize([...seen.values()], 2018)!, 'subaru', 'outback', 'cache');
assert.equal(cv.bolt, '5×114.3', 'same bolt format as wheel pcds');
assert.equal(cv.cb, 56.1);
assert.ok(cv.oe.some(o => o[0] === '225/65R17' && o[1] === 102 && o[5] === 55), 'OE tuple: size, load, ..., offset');
assert.ok(cv.oe.every(o => /^\d{3}\/\d{2}R\d{2}$/.test(o[0])));

const fees = feesFromSettings([
  { key: 'fees', value: { mountBalance: 25, disposal: 6, taxPct: 13, altTolerancePct: 'bad' } },
  { key: 'distributors', value: [{ name: 'Dist A', url: 'https://a.example/?q={size}' }] },
]);
assert.deepEqual([fees.mount, fees.disp, fees.tax, fees.tol, fees.lugs], [25, 6, 13, DEFAULT_FEES.tol, DEFAULT_FEES.lugs]);
assert.deepEqual(fees.dist[0], { name: 'Dist A', url: 'https://a.example/?q={size}' }); assert.equal(fees.dist.length, 3);
assert.equal(DEFAULT_FEES.dist[0].name, '', 'defaults not mutated');

const w = toCounterWheel({ wheel_type: 'steel', condition: 'new', grade: null, diameter: 17, width: null, bolt_pattern: '5x114.3', bolt_pattern_alt: null,
  center_bore: null, wheel_offset: null, description: null, finish: null, lug_seat: null, has_tpms: null, qty: 4, price: null, location: null, notes: null }, 9);
assert.deepEqual([w.pcd, w.w, w.cb, w.et, w.price, w.desc, w.type], ['5×114.3', null, null, null, null, 'Wheel', 'Steel'], 'blank sheet cells stay blank, not 0');

console.log('COUNTER TEST PASSED');

// ---- TireConnect / distributor order links
const { exampleToTemplate: tpl, fillTemplate: fill, hasSlots } = await import('../components/counter/order-link');
const s245 = { w: 245, a: 40, r: 18, key: '245/40R18' };
const cases: [string, string][] = [
  ['https://x.tireconnect.ca/#!/search/size?width=225&profile=65&rim=17', 'https://x.tireconnect.ca/#!/search/size?width=245&profile=40&rim=18'],
  ['https://p.example/search?q=225%2F65R17&loc=2', 'https://p.example/search?q=245%2F40R18&loc=2'],
  ['https://p.example/s/225/65/R17', 'https://p.example/s/245/40/R18'],
  ['https://p.example/?q=2256517', 'https://p.example/?q=2454018'],
  ['https://p.example/?q={size_plain}', 'https://p.example/?q=245/40R18'],
];
for (const [ex, want] of cases) assert.equal(fill(tpl(ex), s245), want, ex);
assert.equal(tpl('https://app.tireconnect.ca/dealer'), 'https://app.tireconnect.ca/dealer', 'no size: left as is, button copies the size');
assert.equal(hasSlots(tpl('https://app.tireconnect.ca/dealer')), false);
assert.equal(tpl('https://p.example/?w=225&page=17'), 'https://p.example/?w=225&page=17', 'half a size is never templated');
assert.equal(feesFromSettings([], { TIRECONNECT_URL: 'https://a.tireconnect.ca/' }).tc, 'https://a.tireconnect.ca/');
assert.equal(feesFromSettings([{ key: 'tireconnect', value: { url: 'https://b.tireconnect.ca/' } }], { TIRECONNECT_URL: 'https://a.tireconnect.ca/' }).tc, 'https://b.tireconnect.ca/', 'shop setting wins over env');
assert.equal(feesFromSettings([{ key: 'tireconnect', value: { url: 'javascript:alert(1)' } }], {}).tc, '', 'only web addresses');
console.log('ORDER LINK TEST PASSED');
