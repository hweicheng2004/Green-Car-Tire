// Turns Wheel-Size's per-trim records into the one-card shape the counter dashboard shows.
import type { WsModification, WsWheelSide } from './wheelsize';

export type OeSize = {
  tire: string;           // "235/65R17"
  loadIndex: number | null;
  speedRating: string | null;
  trims: string[];        // trims that come on this size
  rimDiameter: number;
  rimWidth: number | null;
  offset: number | null;
  stock: boolean;         // true = factory size, false = Wheel-Size listed it as an approved option
  pressurePsi: { front: number | null; rear: number | null };  // door placard pressure
  extraLoad: boolean;     // OE spec calls for XL tires
  steelRim: boolean;      // OE wheel is pressed steel
  staggeredRear?: { tire: string; rimWidth: number | null; offset: number | null; loadIndex?: number | null; speedRating?: string | null };
};

/** "2019–2023" -> [2019, 2023]; "2022–" (current generation) -> [2022, null]. */
export function generationRange(s: string | null | undefined): [number, number | null] | null {
  const m = String(s ?? '').match(/(\d{4})\s*[–-]\s*(\d{4})?/);
  return m ? [Number(m[1]), m[2] ? Number(m[2]) : null] : null;
}
/** Whether a saved fitment's generation covers `year`. An open-ended generation counts up to next year. */
export function generationCovers(s: string | null | undefined, year: number): boolean {
  const r = generationRange(s);
  return !!r && year >= r[0] && year <= (r[1] ?? new Date().getFullYear() + 1);
}

export type Fitment = {
  make: string; model: string; year: number;
  generation: string | null;
  generationYears: string | null;   // "2018–2022"
  boltPattern: string | null;     // "5×114.3"
  centreBoreMm: number | null;
  lugThread: string | null;       // "M12×1.5"
  fastener: string | null;        // "Lug nuts" | "Lug bolts"
  lugSeat: 'conical' | 'ball' | 'flat' | null;
  torqueFtLb: number | null;
  oe: OeSize[];
  /** Set when trims of this year don't share one bolt pattern / bore (rare, but real: e.g. AWD vs FWD, hybrid). */
  mixedSpecs: string[];
  source: 'wheel-size';
  fetchedAt: string;
};

// Wheel-Size doesn't return lug seat type. OE seat by make, used to warn when a set of lugs is needed.
// Override per vehicle in Supabase (vehicle_fitment.lug_seat) if your techs find an exception.
const SEAT_BY_MAKE: Record<string, Fitment['lugSeat']> = {
  honda: 'ball', acura: 'ball',
  toyota: 'flat', lexus: 'flat',       // OE alloys; OE steels are conical
  'mercedes-benz': 'ball', volkswagen: 'ball', audi: 'ball', porsche: 'ball',
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const tireKey = (s?: string) => {
  const m = String(s ?? '').match(/(\d{3})\s*\/\s*(\d{2})\s*Z?R\s*(\d{2}(?:\.\d)?)/i);
  return m ? `${m[1]}/${m[2]}R${m[3]}` : null;
};
const pretty = (s: string | null | undefined) => (s ? s.replace(/\s*x\s*/gi, '×') : null);

export function torqueToFtLb(s?: string): number | null {
  if (!s) return null;
  const n = (s.match(/[\d.]+/g) || []).map(Number).filter(Number.isFinite);
  if (!n.length) return null;
  const v = Math.max(...n);                       // "108 - 113 Nm" -> use the top of the range
  return /lb/i.test(s) ? Math.round(v) : Math.round(v * 0.7376);
}

function sideLI(w: WsWheelSide): number | null {
  const direct = num(w.load_index);
  if (direct !== null) return direct;
  const m = String(w.tire_full ?? '').match(/\s(\d{2,3})(?:\/\d{2,3})?\s*([A-Z])\b/);
  return m ? Number(m[1]) : null;
}
function sideSR(w: WsWheelSide): string | null {
  if (w.speed_index) return String(w.speed_index).toUpperCase();
  const m = String(w.tire_full ?? '').match(/\s\d{2,3}(?:\/\d{2,3})?\s*([A-Z])\b/);
  return m ? m[1] : null;
}
function rimFromString(rim?: string) {
  // "7Jx17 ET45" / "7.5J x 18 ET 50"
  const m = String(rim ?? '').match(/([\d.]+)\s*J?\s*x\s*([\d.]+).*?ET\s*(-?\d+)/i);
  return m ? { width: Number(m[1]), dia: Number(m[2]), et: Number(m[3]) } : null;
}

export function normalize(mods: WsModification[], year: number): Fitment | null {
  if (!mods.length) return null;
  const first = mods[0];

  // Technical specs: use the most common value across trims, and flag disagreement.
  const tally = <T,>(vals: (T | null)[]) => {
    const c = new Map<string, { v: T; n: number }>();
    for (const v of vals) if (v !== null && v !== undefined) {
      const k = String(v); const e = c.get(k) || { v, n: 0 }; e.n++; c.set(k, e);
    }
    const sorted = [...c.values()].sort((a, b) => b.n - a.n);
    return { top: sorted[0]?.v ?? null, distinct: sorted.map(s => String(s.v)) };
  };
  const bolt = tally(mods.map(m => pretty(m.technical?.bolt_pattern)));
  const cb = tally(mods.map(m => num(m.technical?.centre_bore)));
  const thread = tally(mods.map(m => pretty(m.technical?.wheel_fasteners?.thread_size)));
  const mixed: string[] = [];
  if (bolt.distinct.length > 1) mixed.push(`Bolt pattern varies by trim: ${bolt.distinct.join(', ')}`);
  if (cb.distinct.length > 1) mixed.push(`Center bore varies by trim: ${cb.distinct.join(', ')} mm`);
  if (thread.distinct.length > 1) mixed.push(`Lug thread varies by trim: ${thread.distinct.join(', ')}`);

  // OE sizes: merge identical tire+rim combos across trims.
  const sizes = new Map<string, OeSize>();
  for (const m of mods) {
    // "2.5i Premium", "2.5i Limited"... Engine name once, then each trim level.
    const eng = (m.trim || m.name || '').trim();
    const levels = m.trim_levels?.length ? m.trim_levels.map(l => `${eng} ${l}`.trim()) : [eng || 'All trims'];
    for (const w of m.wheels ?? []) {
      const f = w.front; if (!f) continue;
      const tire = tireKey(f.tire || f.tire_full); if (!tire) continue;
      const parsed = rimFromString(f.rim);
      const rimDiameter = num(f.rim_diameter) ?? parsed?.dia ?? Number(tire.split('R')[1]);
      const rimWidth = num(f.rim_width) ?? parsed?.width ?? null;
      const offset = num(f.rim_offset) ?? parsed?.et ?? null;
      const stock = w.is_stock !== false;
      let rear: OeSize['staggeredRear'];
      if (w.rear && !w.showing_fp_only) {
        const rt = tireKey(w.rear.tire || w.rear.tire_full);
        const rp = rimFromString(w.rear.rim);
        if (rt && rt !== tire) rear = { tire: rt, rimWidth: num(w.rear.rim_width) ?? rp?.width ?? null, offset: num(w.rear.rim_offset) ?? rp?.et ?? null,
          loadIndex: sideLI(w.rear), speedRating: sideSR(w.rear) };
      }
      const k = `${stock}|${tire}|${rimWidth}|${offset}|${rear?.tire ?? ''}`;  // factory vs optional kept apart
      const e = sizes.get(k);
      if (e) {
        for (const t of levels) if (!e.trims.includes(t)) e.trims.push(t);
        const li = sideLI(f); if (li !== null && (e.loadIndex === null || li > e.loadIndex)) e.loadIndex = li; // keep the highest OE load
      } else {
        sizes.set(k, { tire, loadIndex: sideLI(f), speedRating: sideSR(f), trims: [...levels], rimDiameter, rimWidth, offset, stock,
          pressurePsi: { front: num(f.tire_pressure?.psi), rear: num(w.rear?.tire_pressure?.psi) },
          extraLoad: !!w.is_extra_load_tires, steelRim: !!w.is_pressed_steel_rims, staggeredRear: rear });
      }
    }
  }
  const oe = [...sizes.values()].sort((a, b) => Number(b.stock) - Number(a.stock) || a.rimDiameter - b.rimDiameter);

  const makeSlug = first.make?.slug ?? '';
  return {
    make: first.make?.name ?? makeSlug,
    model: first.model?.name ?? first.model?.slug ?? '',
    year,
    generation: first.generation?.name ?? null,
    generationYears: first.generation?.start ? `${first.generation.start}–${first.generation.end ?? ''}` : null,
    boltPattern: bolt.top,
    centreBoreMm: cb.top,
    lugThread: thread.top,
    fastener: first.technical?.wheel_fasteners?.type ?? null,
    lugSeat: SEAT_BY_MAKE[makeSlug] ?? 'conical',
    torqueFtLb: torqueToFtLb(first.technical?.wheel_tightening_torque),
    oe,
    mixedSpecs: mixed,
    source: 'wheel-size',
    fetchedAt: new Date().toISOString(),
  };
}
