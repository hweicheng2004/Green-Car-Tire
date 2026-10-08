// Counter shorthand -> make/model slugs from the local vehicle_models table. Zero API hits.
// Shared by GET /api/vehicles and the counter's vehicle lookup.
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseVehicleQuery, compact } from './vehicle-query';
import { regions } from './wheelsize';

export type ModelMatch = { make_slug: string; make_name: string; model_slug: string; model_name: string };

export async function findModels(db: SupabaseClient, q: string): Promise<{ year: number | null; matches: ModelMatch[] }> {
  const parsed = parseVehicleQuery(q);
  if (!parsed) return { year: null, matches: [] };
  const words = parsed.text.split(' ');
  let makeFilter: string | null = null;
  let modelText = parsed.text;

  // "honda civic" -> make=honda, model text "civic"
  if (parsed.makeHint) {
    const { data: mk } = await db.from('vehicle_models').select('make_slug')
      .in('region', regions()).eq('make_compact', compact(parsed.makeHint)).limit(1);
    if (mk?.length) { makeFilter = mk[0].make_slug; modelText = words.slice(1).join(' '); }
  }

  const mc = compact(modelText);
  if (mc.length < 2) return { year: parsed.year, matches: [] };

  let query = db.from('vehicle_models')
    .select('make_slug, make_name, model_slug, model_name, model_compact')
    .in('region', regions()).like('model_compact', `${mc}%`).limit(24);
  if (makeFilter) query = query.eq('make_slug', makeFilter);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // exact compact match first ("civic" before "civic-type-r"), then shortest
  const uniq = [...new Map((data ?? []).map(m => [`${m.make_slug}/${m.model_slug}`, m])).values()];
  const matches = uniq.sort((a, b) =>
    Number(b.model_compact === mc) - Number(a.model_compact === mc) || a.model_compact.length - b.model_compact.length)
    .map(({ model_compact, ...m }) => m).slice(0, 12);
  return { year: parsed.year, matches };
}
