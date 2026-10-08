// The shapes the counter screen (components/counter/counter.js) works with, and the mappers into them.
// Live mode fills them from Supabase and Wheel-Size; demo mode (lib/demo.ts) from built-in sample data.
import type { TireRow, WheelRow } from './inventory-clean';
import type { Fitment } from './fitment';

export type CounterTire = {
  id: number; size: string; brand: string; model: string; season: 'W' | 'AW' | 'AS' | 'S' | null;
  used: boolean; tread: number | null; li: number | null; sr: string | null; xl: boolean; dot: number | null;
  qty: number; price: number | null; loc: string;
};
export type CounterWheel = {
  id: number; type: 'Alloy' | 'Steel'; grade: 'A' | 'B' | 'C' | null; used: boolean; d: number; w: number | null;
  pcd: string; pcds: string[]; cb: number | null; et: number | null; desc: string; finish: string;
  seat: 'conical' | 'ball' | 'flat' | null; qty: number; price: number | null; loc: string;
};
/** OE size tuple, same order as the prototype: size, load index, speed rating, trims, rim width, offset. */
export type CounterOe = [string, number | null, string | null, string, number | null, number | null];
export type CounterVehicle = {
  make: string; model: string; makeSlug: string; modelSlug: string; year: number; assumed: boolean;
  gen: string | null; bolt: string | null; cb: number | null; lug: string | null;
  seat: 'conical' | 'ball' | 'flat' | null; tq: number | null; oe: CounterOe[]; mixed: string[];
  source: 'demo' | 'cache' | 'api' | 'stale';
};
export type VehicleResult =
  | { vehicle: CounterVehicle }
  | { miss: { year: number | null; label: string; why: string } }
  | { none: true };
export type Fees = {
  mount: number; disp: number; tpms: number; tpmsOn: boolean; tax: number; tol: number;
  rings: number; lugs: number; sensor: number; dist: { name: string; url: string }[];
};
export type CounterInventory = {
  mode: 'demo' | 'live'; status: string; tires: CounterTire[]; wheels: CounterWheel[]; fees: Fees;
  tries: { vehicles: string[]; sizes: string[] };
};

const SIZE = /^\d{3}\/\d{2}R\d{2}$/;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const xBolt = (s: string) => s.replace(/x/gi, '×');

export function toCounterTire(r: TireRow, id: number): CounterTire {
  return {
    id, size: r.tire_size, brand: r.brand ?? '', model: r.model ?? '', season: (r.season as CounterTire['season']) ?? null,
    used: r.condition === 'used', tread: r.condition === 'used' ? r.tread_32nds : null,
    li: r.load_index, sr: r.speed_rating, xl: !!r.is_xl, dot: r.dot_year,
    qty: r.qty ?? 0, price: num(r.price), loc: r.location ?? '',
  };
}

export function toCounterWheel(r: WheelRow, id: number): CounterWheel {
  const pcds = [r.bolt_pattern, r.bolt_pattern_alt].filter((p): p is string => !!p).map(xBolt);
  return {
    id, type: r.wheel_type === 'steel' ? 'Steel' : 'Alloy', grade: (r.grade as CounterWheel['grade']) ?? null,
    used: r.condition === 'used', d: Number(r.diameter), w: num(r.width), pcd: pcds.join(' / '), pcds,
    cb: num(r.center_bore), et: num(r.wheel_offset), desc: r.description ?? 'Wheel', finish: r.finish ?? '',
    seat: (r.lug_seat as CounterWheel['seat']) ?? null, qty: r.qty ?? 0, price: num(r.price), loc: r.location ?? '',
  };
}

export function fitmentToCounter(f: Fitment, makeSlug: string, modelSlug: string, source: CounterVehicle['source']): CounterVehicle {
  // Factory sizes first; options only if Wheel-Size listed no factory size the counter can read.
  const usable = f.oe.filter(o => SIZE.test(o.tire));
  const stock = usable.filter(o => o.stock);
  const list = stock.length ? stock : usable;
  return {
    make: f.make, model: f.model, makeSlug, modelSlug, year: f.year, assumed: false,
    gen: f.generationYears, bolt: f.boltPattern, cb: f.centreBoreMm, lug: f.lugThread, seat: f.lugSeat, tq: f.torqueFtLb,
    oe: list.map(o => [o.tire, o.loadIndex, o.speedRating, o.trims.join(', '), o.rimWidth, o.offset]),
    mixed: f.mixedSpecs, source,
  };
}

export const DEFAULT_FEES: Fees = {
  mount: 20, disp: 5, tpms: 10, tpmsOn: false, tax: 13, tol: 3, rings: 25, lugs: 45, sensor: 65,
  dist: [{ name: '', url: '' }, { name: '', url: '' }, { name: '', url: '' }],
};

/** shop_settings rows (migration 003) -> counter fees. Missing or bad values fall back to the defaults. */
export function feesFromSettings(rows: { key: string; value: unknown }[]): Fees {
  const fees = { ...DEFAULT_FEES, dist: [...DEFAULT_FEES.dist] };
  const f = (rows.find(r => r.key === 'fees')?.value ?? {}) as Record<string, unknown>;
  const map: [keyof Fees, string][] = [['mount', 'mountBalance'], ['disp', 'disposal'], ['tpms', 'tpmsKit'], ['rings', 'hubRingsSet'],
    ['lugs', 'lugSet'], ['sensor', 'tpmsSensor'], ['tax', 'taxPct'], ['tol', 'altTolerancePct']];
  for (const [k, s] of map) { const n = num(f[s]); if (n !== null && n >= 0) (fees[k] as number) = n; }
  const d = rows.find(r => r.key === 'distributors')?.value;
  if (Array.isArray(d)) {
    d.slice(0, 3).forEach((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      fees.dist[i] = { name: String(o.name ?? ''), url: String(o.url ?? '') };
    });
  }
  return fees;
}
