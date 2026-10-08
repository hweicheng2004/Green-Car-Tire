// One-time (then yearly) load of every make and model sold in the region into vehicle_models.
// Cost: 1 hit for makes + 1 per make (about 50-60 for Canada). Run: npx tsx scripts/seed-models.ts
import 'dotenv/config';
import { listMakes, listModels, regions } from '../lib/wheelsize';
import { supabaseAdmin } from '../lib/supabase-admin';


async function main() { for (const r of regions()) await seed(r); }

async function seed(REGION: ReturnType<typeof regions>[number]) {
  const db = supabaseAdmin();
  const makes = await listMakes(REGION);
  console.log(`${makes.length} makes in ${REGION}`);
  let total = 0;
  for (const mk of makes) {
    const models = await listModels(mk.slug, REGION);
    const rows = models.map(m => ({ make_slug: mk.slug, make_name: mk.name, model_slug: m.slug, model_name: m.name, region: REGION }));
    if (rows.length) {
      const { error } = await db.from('vehicle_models').upsert(rows);
      if (error) throw error;
    }
    total += rows.length;
    console.log(`  ${mk.name.padEnd(18)} ${rows.length} models`);
    await new Promise(r => setTimeout(r, 250));   // be polite
  }
  console.log(`Done: ${total} models, ${makes.length + 1} API hits.`);
}
main().catch(e => { console.error(e.message ?? e); process.exit(1); });
