// The counter. Stock, fees and the status line are loaded on the server and sent with the page,
// so the screen is ready on first paint instead of waiting for a second request.
import Counter from '@/components/counter/Counter';
import Splash from '@/components/Splash';
import { isDemo, demoInventory } from '@/lib/demo';
import { liveInventory } from '@/lib/counter-live';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export default async function Home() {
  try {
    return <><Splash /><Counter data={isDemo() ? demoInventory() : await liveInventory(supabaseAdmin())} /></>;
  } catch (e) {
    return <><Splash /><Counter error={(e as Error).message} /></>;
  }
}
