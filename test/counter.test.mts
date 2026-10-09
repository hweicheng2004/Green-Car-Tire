// Counter data: demo mode (no accounts) and the mappers live mode uses.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { isDemo, demoVehicle, demoOeOn, demoInventory, demoIssueSheet, demoCatalog } from '../lib/demo';
import { parseYear } from '../lib/vehicle-query';
import { fitmentToCounter, feesFromSettings, toCounterWheel, DEFAULT_FEES } from '../lib/counter-data';
import { normalize } from '../lib/fitment';
import type { WsModification } from '../lib/wheelsize';

// ---- when demo mode is on
assert.equal(isDemo({}), true, 'no Supabase = demo');
assert.equal(isDemo({ SUPABASE_URL: 'https://x.supabase.co' }), false);
assert.equal(isDemo({ SUPABASE_URL: 'https://x.supabase.co', DEMO_MODE: '1' }), true, 'forced on');
assert.equal(isDemo({ DEMO_MODE: '0' }), false, 'forced off');

// ---- demo vehicles: the three boxes (year, make, model), names or slugs
const ask = (year: number | null, make: string, model: string) => ({ year, make, model });
const veh = (y: number | null, mk: string, md: string) => { const r = demoVehicle(ask(y, mk, md)); assert.ok('vehicle' in r, `${y} ${mk} ${md}`); return r.vehicle; };
assert.deepEqual([veh(2018, 'Subaru', 'Outback').year, veh(2018, 'subaru', 'outback').gen, veh(2018, 'Subaru', 'Outback').oe[0][0]], [2018, '2015–2019', '225/65R17']);
assert.equal(veh(2019, 'Honda', 'Civic').model, 'Civic');
assert.equal(veh(2020, 'honda', 'crv').model, 'CR-V', 'CR-V typed without the dash');
assert.equal(veh(2017, 'Ford', 'F150').bolt, '6×135');
assert.ok('miss' in demoVehicle(ask(null, 'Subaru', 'Outback')), 'no year: asks for it');
const miss = demoVehicle(ask(2009, 'Honda', 'Civic')); assert.ok('miss' in miss && miss.miss.label === 'Honda Civic');
assert.ok('none' in demoVehicle(ask(2018, 'Zzz', 'outback'))); assert.ok('none' in demoVehicle(ask(2018, '', '')));
assert.ok('none' in demoVehicle(ask(2018, 'Toyota', 'Outback')), 'model must belong to the make');

// Not saved yet: ask first, look up only when confirmed, then it's saved.
const ask1 = demoVehicle(ask(2019, 'Mazda', 'CX-5'));
assert.ok('needsLookup' in ask1, 'unsaved vehicle prompts instead of looking up');
assert.deepEqual([ask1.needsLookup.label, ask1.needsLookup.hitsNeeded, ask1.needsLookup.hitsToday], ['Mazda CX-5', 2, 0]);
assert.ok('needsLookup' in demoVehicle(ask(2019, 'Mazda', 'CX-5')), 'asking again still costs nothing');
const got = demoVehicle(ask(2019, 'mazda', 'cx-5'), true);
assert.ok('vehicle' in got && got.vehicle.model === 'CX-5', 'confirmed lookup returns the vehicle');
assert.ok('vehicle' in demoVehicle(ask(2021, 'Mazda', 'CX-5')), 'saved now, no prompt');
const esc = demoVehicle(ask(2022, 'Ford', 'Escape'));
assert.ok('needsLookup' in esc && esc.needsLookup.hitsToday === 2, 'quota shown counts earlier lookups');

assert.deepEqual(demoOeOn('225/65R17').map(v => v.label).slice(0, 2), ['2015–2019 Subaru Outback', '2020–2024 Subaru Outback']);
assert.ok(demoOeOn('225/65R17').every(v => !('none' in demoVehicle(ask(v.year, v.make, v.model)))), '"OE on" buttons fill boxes that resolve');
const cat = demoCatalog();
assert.deepEqual(cat.find(m => m.slug === 'honda')!.models.map(m => m.name).sort(), ['CR-V', 'Civic', 'Civic Type R']);

// The Type R is a separate model (own bolt pattern and tires): a Civic offers it as a switch, and back.
const civic25 = veh(2025, 'Honda', 'Civic');
assert.deepEqual([civic25.gen, civic25.bolt, civic25.related?.map(r => r.label)], ['2022–2025', '5×114.3', ['Honda Civic Type R']], 'typing Civic gets the Civic, with the Type R offered');
const typeR = veh(2025, 'Honda', civic25.related![0].modelSlug);
assert.deepEqual([typeR.model, typeR.bolt, typeR.oe[0][0], typeR.related?.map(r => r.modelSlug)], ['Civic Type R', '5×120', '265/30R19', ['civic']]);
assert.equal(veh(2025, 'Honda', 'Civic Type R').model, 'Civic Type R', 'typed in full');
assert.equal(veh(2019, 'Honda', 'Civic').related?.[0].label, 'Honda Civic Type R');
assert.equal(veh(2018, 'Subaru', 'Outback').related, undefined, 'no related models: no section');

// Live: related models come from the local list, children and parents, never the vehicle itself.
const { relatedModels } = await import('../lib/vehicle-lookup');
const vm = [{ model_slug: 'civic', model_name: 'Civic', make_name: 'Honda' }, { model_slug: 'civic-type-r', model_name: 'Civic Type R', make_name: 'Honda' },
  { model_slug: 'civic-si', model_name: 'Civic Si', make_name: 'Honda' }, { model_slug: 'cr-v', model_name: 'CR-V', make_name: 'Honda' }];
const relDb: any = { from: () => { const f: any = {}; const c: any = {
  select: () => c, eq: () => c, limit: () => c,
  in: (k: string, v: string[]) => { if (k === 'model_slug') f.in = v; return c; },
  like: (_k: string, v: string) => { f.like = v.replace('%', ''); return c; },
  then: (res: any) => res({ data: vm.filter(r => (f.in ? f.in.includes(r.model_slug) : true) && (f.like ? r.model_slug.startsWith(f.like) : true)), error: null }) }; return c; } };
assert.deepEqual((await relatedModels(relDb, 'honda', 'civic')).map(r => r.modelSlug).sort(), ['civic-si', 'civic-type-r']);
assert.deepEqual((await relatedModels(relDb, 'honda', 'civic-type-r')).map(r => r.modelSlug), ['civic']);
assert.deepEqual(await relatedModels(relDb, 'honda', 'cr-v'), [], 'cr-v has no parent "cr" and no children');

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
for (const v of inv.tries.vehicles) assert.ok('vehicle' in demoVehicle(ask(v.year, v.make, v.model)), `Try button "${v.label}" resolves`);
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

// ---- year box
const yNow = new Date().getFullYear();
assert.deepEqual(['18', '2018', '99', '1999', '201', '', 'abc', String(yNow + 5)].map(parseYear), [2018, 2018, 1999, 1999, null, null, null, null]);

// ---- live: the counter never calls Wheel-Size unless the lookup is confirmed
const { liveVehicle } = await import('../lib/counter-live');
const models = [{ make_slug: 'mazda', make_name: 'Mazda', model_slug: 'cx-5', model_name: 'CX-5', model_compact: 'cx5' },
  { make_slug: 'mazda', make_name: 'Mazda', model_slug: 'cx-50', model_name: 'CX-50', model_compact: 'cx50' }];
let wsCalls = 0, saved: unknown = null;
const q = (table: string) => {
  const f: Record<string, unknown> = {};
  const chain: any = {
    select: () => chain, in: () => chain, order: () => chain, limit: () => chain,
    eq: (k: string, v: unknown) => { f[k] = v; return chain; }, like: (k: string, v: string) => { f[k] = v; return chain; },
    match: (m: Record<string, unknown>) => { Object.assign(f, m); return chain; },
    maybeSingle: async () => ({ data: table === 'vehicle_fitment' ? saved : table === 'wheelsize_usage' ? { hits: 40 } : null, error: null }),
    upsert: async (row: unknown) => { saved = { data: (row as any).data, lug_seat: null, fetched_at: new Date().toISOString() }; return { error: null }; },
    then: (res: (v: unknown) => unknown) => res({ data: table === 'vehicle_models'
      ? models.filter(m => m.make_slug === f.make_compact && m.model_compact.startsWith(String(f.model_compact).replace('%', ''))) : [], error: null }),
  };
  return chain;
};
const fakeDb: any = { from: q, rpc: async (fn: string) => { if (fn === 'wheelsize_hit') wsCalls++; return { data: 1, error: null }; } };
const prevFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response(JSON.stringify({ data: JSON.parse(readFileSync(new URL('./fixture-outback-2018.json', import.meta.url), 'utf8')).usdm }))) as any;
process.env.WHEELSIZE_API_KEY = 'test';
const l1 = await liveVehicle(fakeDb, { year: 2019, make: 'Mazda', model: 'cx' });
assert.ok('needsLookup' in l1, 'unsaved: prompt');
assert.equal(wsCalls, 0, 'no Wheel-Size call without confirmation');
assert.deepEqual([l1.needsLookup.label, l1.needsLookup.options.map(o => o.label), l1.needsLookup.hitsToday], ['Mazda CX-5', ['Mazda CX-5', 'Mazda CX-50'], 40]);
// Not in the make/model list (list not loaded, new model, or a typo): still offered, flagged, looked up by the typed name.
const un = await liveVehicle(fakeDb, { year: 2019, make: 'Mazda', model: 'Miata MX-5' });
assert.ok('needsLookup' in un && un.needsLookup.unlisted === true);
assert.deepEqual([un.needsLookup.makeSlug, un.needsLookup.modelSlug, un.needsLookup.label, un.needsLookup.options.length], ['mazda', 'miata-mx-5', 'Mazda Miata MX-5', 1]);
assert.equal(wsCalls, 0, 'offering costs nothing');
// No Wheel-Size key: the prompt says so, and even a confirmed lookup spends nothing.
delete process.env.WHEELSIZE_API_KEY;
const nokey = await liveVehicle(fakeDb, { year: 2019, make: 'mazda', model: 'cx-5' }, true);
assert.ok('needsLookup' in nokey && nokey.needsLookup.keyMissing === true); assert.equal(wsCalls, 0);
process.env.WHEELSIZE_API_KEY = 'test';
const l2 = await liveVehicle(fakeDb, { year: 2019, make: 'mazda', model: 'cx-5' }, true);
assert.ok('vehicle' in l2 && l2.vehicle.source === 'api'); assert.equal(wsCalls, 2, 'confirmed: one hit per market');
const l3 = await liveVehicle(fakeDb, { year: 2019, make: 'Mazda', model: 'CX-5' });
assert.ok('vehicle' in l3 && l3.vehicle.source === 'cache'); assert.equal(wsCalls, 2, 'saved now: free');
globalThis.fetch = prevFetch;
console.log('VEHICLE LOOKUP TEST PASSED');
