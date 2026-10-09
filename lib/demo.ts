// Demo mode: the whole app runs on built-in sample data, with no Supabase, Google or Wheel-Size accounts.
// On when DEMO_MODE=1, or automatically when SUPABASE_URL isn't set (a fresh Vercel deploy with no env vars).
// Inventory is demo/demo-inventory.json (the same cells as the demo Google Sheet) run through the real sheet cleaner,
// so the demo shows exactly what a sync of that sheet would put on the counter.
import demoBook from '../demo/demo-inventory.json';
import { cleanTab, planKind, issueSheet, type KindPlan, type TabResult } from './inventory-sync';
import type { TireRow, WheelRow } from './inventory-clean';
import { compact } from './vehicle-query';
import type { Catalog } from './vehicle-lookup';
import { toCounterTire, toCounterWheel, feesFromSettings, TRIES, type VehicleAsk, type CounterInventory, type CounterVehicle, type CounterOe, type VehicleResult } from './counter-data';

export const isDemo = (env: Record<string, string | undefined> = process.env) =>
  env.DEMO_MODE === '1' || env.DEMO_MODE === 'true' || (!env.SUPABASE_URL && env.DEMO_MODE !== '0');

const book = demoBook as Record<string, string[][]>;

// ---------------------------------------------------------------- vehicles (sample fitment, not from Wheel-Size)
type DemoVeh = { make: string; model: string; makeSlug: string; modelSlug: string; from: number; to: number;
  bolt: string; cb: number; lug: string; seat: 'conical' | 'ball' | 'flat'; tq: number; oe: CounterOe[] };
const v = (make: string, model: string, modelSlug: string, from: number, to: number, bolt: string, cb: number, lug: string,
  seat: DemoVeh['seat'], tq: number, oe: [string, number, string, string, number, number][]): DemoVeh =>
  ({ make, model, makeSlug: make.toLowerCase(), modelSlug, from, to, bolt, cb, lug, seat, tq, oe });

export const DEMO_VEHICLES: DemoVeh[] = [
  v('Subaru', 'Outback', 'outback', 2015, 2019, '5×114.3', 56.1, 'M12×1.25', 'conical', 89, [['225/65R17', 102, 'H', '2.5i, Premium', 7, 48], ['225/60R18', 100, 'H', 'Limited, Touring', 7, 48]]),
  v('Subaru', 'Outback', 'outback', 2020, 2024, '5×114.3', 56.1, 'M12×1.25', 'conical', 89, [['225/65R17', 102, 'H', 'Base, Premium', 7, 48], ['225/60R18', 100, 'H', 'Limited, Touring, Wilderness', 7, 48]]),
  v('Toyota', 'RAV4', 'rav4', 2019, 2024, '5×114.3', 60.1, 'M12×1.5', 'flat', 76, [['225/65R17', 102, 'H', 'LE, XLE', 7, 35], ['225/60R18', 100, 'H', 'XLE Premium, Adventure', 7, 35], ['235/55R19', 101, 'V', 'Limited', 7.5, 40]]),
  v('Honda', 'CR-V', 'cr-v', 2017, 2022, '5×114.3', 64.1, 'M12×1.5', 'ball', 80, [['235/65R17', 104, 'T', 'LX', 7, 45], ['235/60R18', 103, 'H', 'EX, EX-L, Touring', 7.5, 45]]),
  v('Honda', 'Civic', 'civic', 2016, 2021, '5×114.3', 64.1, 'M12×1.5', 'ball', 80, [['215/55R16', 93, 'V', 'LX', 6.5, 45], ['215/50R17', 91, 'V', 'EX, Touring', 7, 45], ['235/40R18', 95, 'W', 'Sport', 8, 50]]),
  v('Honda', 'Civic', 'civic', 2022, 2025, '5×114.3', 64.1, 'M12×1.5', 'ball', 80, [['215/55R16', 93, 'H', 'LX', 7, 45], ['215/50R17', 91, 'H', 'EX, Touring', 7, 50], ['235/40R18', 95, 'W', 'Sport, Si', 8, 50]]),
  // The Type R is its own model in Wheel-Size: different bolt pattern and tires, so the Civic offers it as a switch.
  v('Honda', 'Civic Type R', 'civic-type-r', 2017, 2021, '5×120', 64.1, 'M14×1.5', 'ball', 94, [['245/30R20', 90, 'Y', 'Type R', 8.5, 60]]),
  v('Honda', 'Civic Type R', 'civic-type-r', 2023, 2025, '5×120', 64.1, 'M14×1.5', 'ball', 94, [['265/30R19', 93, 'Y', 'Type R', 9.5, 60]]),
  v('Toyota', 'Corolla', 'corolla', 2019, 2024, '5×100', 54.1, 'M12×1.5', 'flat', 76, [['195/65R15', 91, 'H', 'L, LE', 6, 40], ['205/55R16', 91, 'V', 'LE, XLE', 6.5, 40], ['225/40R18', 92, 'Y', 'SE, XSE', 8, 40]]),
  v('Ford', 'F-150', 'f-150', 2015, 2020, '6×135', 87.1, 'M14×2.0', 'conical', 150, [['265/70R17', 115, 'T', 'XL, XLT', 7.5, 44], ['275/65R18', 116, 'T', 'XLT, Lariat', 7.5, 44], ['275/55R20', 111, 'T', 'Platinum, Limited', 8.5, 44]]),
  v('Mazda', 'CX-5', 'cx-5', 2017, 2024, '5×114.3', 67.1, 'M12×1.5', 'conical', 80, [['225/65R17', 102, 'H', 'GX, GS', 7, 50], ['225/55R19', 99, 'V', 'GT, Signature', 7, 45]]),
  v('Ford', 'Escape', 'escape', 2020, 2024, '5×108', 63.4, 'M14×1.5', 'conical', 100, [['225/65R17', 102, 'H', 'S, SE', 7, 52], ['225/60R18', 100, 'H', 'SEL', 7.5, 52], ['225/55R19', 99, 'H', 'Titanium', 8, 52]]),
];

const toCounter = (d: DemoVeh, year: number, assumed: boolean): CounterVehicle => ({
  make: d.make, model: d.model, makeSlug: d.makeSlug, modelSlug: d.modelSlug, year, assumed,
  gen: `${d.from}–${d.to}`, bolt: d.bolt, cb: d.cb, lug: d.lug, seat: d.seat, tq: d.tq, oe: d.oe, mixed: [], source: 'demo',
  ...(demoRelated(d).length ? { related: demoRelated(d) } : {}),
});
const demoRelated = (d: DemoVeh) => [...new Map(DEMO_VEHICLES
  .filter(x => x.makeSlug === d.makeSlug && x.modelSlug !== d.modelSlug && (x.modelSlug.startsWith(d.modelSlug + '-') || d.modelSlug.startsWith(x.modelSlug + '-')))
  .map(x => [x.modelSlug, { makeSlug: x.makeSlug, modelSlug: x.modelSlug, label: `${x.make} ${x.model}` }])).values()];

// To show the "look it up?" popup without accounts, these demo vehicles start as not saved. Confirming a lookup
// "saves" them for this server instance, like a real Wheel-Size lookup saves to Supabase.
const NOT_SAVED = new Set(['mazda/cx-5', 'ford/escape']);
let demoHits = 0;

/** Year + make + model from the three counter boxes, against the sample vehicles. Same rules as live mode. */
export function demoVehicle(ask: VehicleAsk, lookup = false): VehicleResult {
  const mk = compact(ask.make), md = compact(ask.model);
  if (!mk || !md) return { none: true };
  const cands = DEMO_VEHICLES.filter(d => compact(d.makeSlug) === mk && compact(d.modelSlug).startsWith(md))
    .sort((a, b) => Number(compact(b.modelSlug) === md) - Number(compact(a.modelSlug) === md));
  const pick = lookup ? cands.filter(d => compact(d.modelSlug) === md) : cands.filter(d => d.modelSlug === cands[0]?.modelSlug);
  if (!pick.length) return { none: true };
  const first = pick[0], key = `${first.makeSlug}/${first.modelSlug}`, label = `${first.make} ${first.model}`;
  if (ask.year === null) return { miss: { year: null, label, why: 'Add the year to look up fitment.' } };
  if (NOT_SAVED.has(key)) {
    if (!lookup) {
      const opts = [...new Map(cands.map(d => [`${d.makeSlug}/${d.modelSlug}`, { makeSlug: d.makeSlug, modelSlug: d.modelSlug, label: `${d.make} ${d.model}` }])).values()];
      return { needsLookup: { year: ask.year, makeSlug: first.makeSlug, modelSlug: first.modelSlug, label, options: opts, hitsNeeded: 2, hitsToday: demoHits, dailyLimit: 300 } };
    }
    NOT_SAVED.delete(key); demoHits += 2;
  }
  const hit = pick.find(d => ask.year! >= d.from && ask.year! <= d.to);
  return hit ? { vehicle: toCounter(hit, ask.year, false) }
    : { miss: { year: ask.year, label, why: 'The demo only has sample fitment for a few model years.' } };
}

/** Every demo make and model, for the make/model suggestions. */
export const demoCatalog = (): Catalog => [...new Map(DEMO_VEHICLES.map(d => [d.makeSlug, { slug: d.makeSlug, name: d.make, models: [] as { slug: string; name: string }[] }])).values()]
  .map(m => ({ ...m, models: [...new Map(DEMO_VEHICLES.filter(d => d.makeSlug === m.slug).map(d => [d.modelSlug, { slug: d.modelSlug, name: d.model }])).values()] }));

/** Vehicles that came on a size, for the size search's "OE on" list. */
export function demoOeOn(size: string) {
  return DEMO_VEHICLES.filter(d => d.oe.some(o => o[0] === size))
    .map(d => ({ label: `${d.from}–${d.to} ${d.make} ${d.model}`, year: d.to, make: d.makeSlug, model: d.modelSlug }));
}

// ---------------------------------------------------------------- inventory and sync preview
// The demo sheet never changes, so it's cleaned once per server instance, not on every request.
let demoCache: { results: TabResult[]; plans: KindPlan[] } | null = null;
export function demoSync(): { results: TabResult[]; plans: KindPlan[] } {
  return (demoCache ??= cleanDemo());
}
function cleanDemo() {
  const t = cleanTab('Tires', 'tires', book.Tires), w = cleanTab('Wheels', 'wheels', book.Wheels);
  return {
    results: [t, w],
    plans: [planKind('tires', ['Tires'], [t], [], 'demo', 0, false), planKind('wheels', ['Wheels'], [w], [], 'demo', 0, false)],
  };
}

export function demoIssueSheet(now = new Date()) {
  const { results, plans } = demoSync();
  const when = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.SHOP_TIMEZONE || 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }).format(now);
  return { plans, sheet: issueSheet(results, plans, when) };
}

export function demoInventory(): CounterInventory {
  const { plans } = demoSync();
  return {
    mode: 'demo',
    status: 'Demo mode · sample stock from the demo sheet · no accounts connected',
    tires: plans[0].rows.map((r, i) => toCounterTire(r as TireRow, i)),
    wheels: plans[1].rows.map((r, i) => toCounterWheel(r as WheelRow, i)),
    fees: feesFromSettings([]),
    tries: { vehicles: TRIES, sizes: ['225 65 17', '2056016', '265/70R17'] },
  };
}
