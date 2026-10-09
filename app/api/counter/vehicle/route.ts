// GET /api/counter/vehicle?year=2018&make=subaru&model=outback — the three vehicle boxes. Saved fitments only:
// it never calls Wheel-Size. A vehicle not saved yet comes back { needsLookup } and the counter asks first.
// Add &lookup=1 for the confirmed lookup (2 Wheel-Size hits for a new vehicle-year, then saved for everyone).
import { NextResponse } from 'next/server';
import { isDemo, demoVehicle } from '@/lib/demo';
import { liveVehicle } from '@/lib/counter-live';
import { parseYear } from '@/lib/vehicle-query';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const ask = { year: parseYear(sp.get('year')), make: (sp.get('make') ?? '').slice(0, 60), model: (sp.get('model') ?? '').slice(0, 60) };
  const lookup = sp.get('lookup') === '1';
  try {
    const r = isDemo() ? demoVehicle(ask, lookup) : await liveVehicle(supabaseAdmin(), ask, lookup);
    // A found vehicle is the same answer for everyone for months; cache it at Vercel's edge for a day.
    // "Not saved yet" and errors are never cached, so the vehicle shows the moment someone looks it up.
    const cache = 'vehicle' in r && r.vehicle.source !== 'stale' ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'no-store';
    return NextResponse.json(r, { headers: { 'cache-control': cache } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
