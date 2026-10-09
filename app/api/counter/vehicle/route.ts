// GET /api/counter/vehicle?q=18 outback — the vehicle box. One call: shorthand -> model -> cached fitment.
import { NextResponse } from 'next/server';
import { isDemo, demoVehicle } from '@/lib/demo';
import { liveVehicle } from '@/lib/counter-live';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 80);
  try {
    const r = isDemo() ? demoVehicle(q) : await liveVehicle(supabaseAdmin(), q);
    // A found vehicle is the same answer for everyone for months; cache it at Vercel's edge for a day.
    const cache = 'vehicle' in r && r.vehicle.source !== 'stale' ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'no-store';
    return NextResponse.json(r, { headers: { 'cache-control': cache } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
