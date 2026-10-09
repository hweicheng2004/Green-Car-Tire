// One-time (then yearly) load of every make and model into vehicle_models. Same as the button on /setup.
// Cost: 1 hit for makes + 1 per make, per market (~120 for Canada + US). Run: npm run seed-models
import 'dotenv/config';
import { seedModels } from '../lib/seed-models';
import { supabaseAdmin } from '../lib/supabase-admin';

seedModels(supabaseAdmin(), msg => console.log('  ' + msg))
  .then(r => console.log(`Done: ${r.models} models from ${r.makes} makes (${r.regions.join(' + ')}), ${r.hits} API hits.`))
  .catch(e => { console.error(e.message ?? e); process.exit(1); });
