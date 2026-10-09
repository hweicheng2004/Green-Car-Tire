// Live-mode data for the counter screen: Supabase inventory and settings, Wheel-Size fitment through the cache.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TireRow, WheelRow } from './inventory-clean';
import { findModelsBy } from './vehicle-lookup';
import { compact } from './vehicle-query';
import { getFitment, hitsToday, DAILY_LIMIT } from './fitment-lookup';
import { regions } from './wheelsize';
import { syncStatus } from './inventory-sync-store';
import { explainDbError } from './db-errors';
import { TRIES, type VehicleAsk } from './counter-data';
import { toCounterTire, toCounterWheel, fitmentToCounter, feesFromSettings, type CounterInventory, type VehicleResult } from './counter-data';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// Only what the counter shows. The raw sheet row (jsonb) and notes stay in the database.
const TIRE_COLS = 'id, tire_size, brand, model, season, condition, tread_32nds, load_index, speed_rating, is_xl, dot_year, qty, price, location';
const WHEEL_COLS = 'id, wheel_type, condition, grade, diameter, width, bolt_pattern, bolt_pattern_alt, center_bore, wheel_offset, description, finish, lug_seat, qty, price, location';


export async function liveInventory(db: SupabaseClient): Promise<CounterInventory> {
  const [t, w, s, st] = await Promise.all([
    db.from('tires').select(TIRE_COLS).order('tire_size').limit(5000),
    db.from('wheels').select(WHEEL_COLS).order('diameter').limit(5000),
    db.from('shop_settings').select('key, value'),
    syncStatus(db).catch(() => null),   // status line only; never blocks the counter
  ]);
  for (const r of [t, w, s]) if (r.error) throw new Error(explainDbError(r.error));
  let status = 'Inventory not synced yet';
  if (st) {
    const ok = [st.tires.lastOk, st.wheels.lastOk].filter(Boolean).map(x => x!.synced_at).sort()[0];
    const bad = [st.tires.latest, st.wheels.latest].some(x => x && x.status !== 'ok');
    if (ok) status = `Inventory synced ${ago(ok)}${bad ? ' · last sync had a problem, see /sync' : ''}`;
  }
  return {
    mode: 'live', status,
    tires: (t.data as (TireRow & { id: number })[]).map(r => toCounterTire(r, r.id)),
    wheels: (w.data as (WheelRow & { id: number })[]).map(r => toCounterWheel(r, r.id)),
    fees: feesFromSettings(s.data as { key: string; value: unknown }[]),
    tries: { vehicles: TRIES, sizes: ['225 65 17', '2056016', '265/70R17'] },
  };
}

/** Year + make + model from the three counter boxes. Saved fitments only, unless `lookup` confirms a Wheel-Size
 *  lookup; a confirmed lookup must name an exact model in the vehicle list, so a crafted URL can't spend lookups. */
export async function liveVehicle(db: SupabaseClient, ask: VehicleAsk, lookup = false): Promise<VehicleResult> {
  const matches = await findModelsBy(db, ask.make, ask.model);
  const m = lookup ? matches.find(x => compact(x.model_slug) === compact(ask.model)) : matches[0];
  if (!m) return { none: true };
  const label = `${m.make_name} ${m.model_name}`;
  if (ask.year === null) return { miss: { year: null, label, why: 'Add the year to look up fitment.' } };
  const r = await getFitment(db, m.make_slug, m.model_slug, ask.year, false, lookup);
  if ('notCached' in r) {
    return { needsLookup: {
      year: ask.year, makeSlug: m.make_slug, modelSlug: m.model_slug, label,
      options: matches.slice(0, 6).map(x => ({ makeSlug: x.make_slug, modelSlug: x.model_slug, label: `${x.make_name} ${x.model_name}` })),
      hitsNeeded: regions().length, hitsToday: await hitsToday(db), dailyLimit: DAILY_LIMIT(),
    } };
  }
  if ('error' in r) return { miss: { year: ask.year, label, why: r.error } };
  const src = r.cache === 'hit' ? 'cache' : r.cache === 'miss' ? 'api' : 'stale';
  return { vehicle: fitmentToCounter(r.fit, m.make_slug, m.model_slug, src) };
}

const title = (slug: string) => slug.split('-').map(w => (w.length <= 3 && /\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');

/** Vehicles that came on a size, from fitments already looked up. No API calls; grows as the counter is used. */
export async function liveOeOn(db: SupabaseClient, size: string) {
  const { data, error } = await db.from('fitment_oe_sizes').select('make_slug, model_slug, year')
    .eq('tire_size', size).eq('stock', true).order('year', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  const groups = new Map<string, { make: string; model: string; years: number[] }>();
  for (const r of (data ?? []) as { make_slug: string; model_slug: string; year: number }[]) {
    const k = `${r.make_slug}/${r.model_slug}`;
    const g = groups.get(k) || { make: r.make_slug, model: r.model_slug, years: [] as number[] };
    if (!g.years.includes(r.year)) g.years.push(r.year);
    groups.set(k, g);
  }
  return [...groups.values()].map(g => {
    const ys = g.years.sort((a, b) => a - b), lo = ys[0], hi = ys[ys.length - 1];
    return { label: `${lo === hi ? lo : `${lo}–${hi}`} ${title(g.make)} ${title(g.model)}`, year: hi, make: g.make, model: g.model };
  });
}
