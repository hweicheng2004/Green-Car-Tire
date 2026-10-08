// Live-mode data for the counter screen: Supabase inventory and settings, Wheel-Size fitment through the cache.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TireRow, WheelRow } from './inventory-clean';
import { findModels } from './vehicle-lookup';
import { getFitment } from './fitment-lookup';
import { syncStatus } from './inventory-sync-store';
import { explainDbError } from './db-errors';
import { toCounterTire, toCounterWheel, fitmentToCounter, feesFromSettings, type CounterInventory, type VehicleResult } from './counter-data';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export async function liveInventory(db: SupabaseClient): Promise<CounterInventory> {
  const [t, w, s] = await Promise.all([
    db.from('tires').select('*').order('tire_size').limit(5000),
    db.from('wheels').select('*').order('diameter').limit(5000),
    db.from('shop_settings').select('key, value'),
  ]);
  for (const r of [t, w, s]) if (r.error) throw new Error(explainDbError(r.error));
  let status = 'Inventory not synced yet';
  try {
    const st = await syncStatus(db);
    const ok = [st.tires.lastOk, st.wheels.lastOk].filter(Boolean).map(x => x!.synced_at).sort()[0];
    const bad = [st.tires.latest, st.wheels.latest].some(x => x && x.status !== 'ok');
    if (ok) status = `Inventory synced ${ago(ok)}${bad ? ' · last sync had a problem, see /sync' : ''}`;
  } catch { /* status line only */ }
  return {
    mode: 'live', status,
    tires: (t.data as (TireRow & { id: number })[]).map(r => toCounterTire(r, r.id)),
    wheels: (w.data as (WheelRow & { id: number })[]).map(r => toCounterWheel(r, r.id)),
    fees: feesFromSettings(s.data as { key: string; value: unknown }[]),
    tries: { vehicles: ['18 outback', '20 crv', '2019 honda civic', '17 f150'], sizes: ['225 65 17', '2056016', '265/70R17'] },
  };
}

export async function liveVehicle(db: SupabaseClient, q: string): Promise<VehicleResult> {
  const { year, matches } = await findModels(db, q);
  if (!matches.length) return { none: true };
  const m = matches[0];
  const label = `${m.make_name} ${m.model_name}`;
  if (year === null) return { miss: { year: null, label, why: 'Add the year, like "18 outback", to look up fitment.' } };
  const r = await getFitment(db, m.make_slug, m.model_slug, year);
  if ('error' in r) return { miss: { year, label, why: r.error } };
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
    return { label: `${lo === hi ? lo : `${lo}–${hi}`} ${title(g.make)} ${title(g.model)}`, q: `${hi} ${g.model}` };
  });
}
