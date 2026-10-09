// Loads every make and model Wheel-Size lists for the configured markets into vehicle_models: the counter's
// make/model suggestions. About 1 lookup for the makes plus 1 per make, per market (~120 for Canada + US).
// Run once, then yearly for new models. Used by /setup (button) and scripts/seed-models.ts (command line).
import type { SupabaseClient } from '@supabase/supabase-js';
import { listMakes, listModels, regions, type Region } from './wheelsize';

export type SeedResult = { regions: string[]; makes: number; models: number; hits: number };

export async function seedModels(db: SupabaseClient, onProgress?: (msg: string) => void, concurrency = 6): Promise<SeedResult> {
  let hits = 0, models = 0, makeCount = 0;
  const hit = async () => { hits++; await db.rpc('wheelsize_hit'); };   // counted against the daily limit like lookups
  for (const region of regions() as Region[]) {
    await hit();
    const makes = await listMakes(region);
    makeCount += makes.length;
    let next = 0;
    const worker = async () => {
      while (next < makes.length) {
        const mk = makes[next++];
        await hit();
        const list = await listModels(mk.slug, region);
        const rows = list.map(m => ({ make_slug: mk.slug, make_name: mk.name, model_slug: m.slug, model_name: m.name, region }));
        if (rows.length) {
          const { error } = await db.from('vehicle_models').upsert(rows);
          if (error) throw new Error(error.message);
        }
        models += rows.length;
        onProgress?.(`${region}: ${mk.name} (${rows.length})`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, makes.length) }, worker));
  }
  return { regions: regions(), makes: makeCount, models, hits };
}
