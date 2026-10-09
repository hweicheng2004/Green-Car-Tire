// The counter. Stock, fees and the status line are loaded on the server and sent with the page,
// so the screen is ready on first paint instead of waiting for a second request.
// First use after demo mode is off (no tables yet, or no stock loaded) goes to /setup.
import { redirect } from 'next/navigation';
import Counter from '@/components/counter/Counter';
import Splash from '@/components/Splash';
import { isDemo, demoInventory } from '@/lib/demo';
import { liveInventory } from '@/lib/counter-live';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MISSING_TABLES_HELP } from '@/lib/db-errors';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let data;
  try {
    data = isDemo() ? demoInventory() : await liveInventory(supabaseAdmin());
  } catch (e) {
    if ((e as Error).message === MISSING_TABLES_HELP) redirect('/setup');
    return <><Splash /><Counter error={(e as Error).message} /></>;
  }
  if (data.mode === 'live' && !data.tires.length && !data.wheels.length) redirect('/setup');
  return <><Splash /><Counter data={data} /></>;
}
