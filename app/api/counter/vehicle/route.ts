// GET /api/counter/vehicle?q=18 outback — the vehicle box. One call: shorthand -> model -> cached fitment.
import { NextResponse } from 'next/server';
import { isDemo, demoVehicle } from '@/lib/demo';
import { liveVehicle } from '@/lib/counter-live';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 80);
  try {
    return NextResponse.json(isDemo() ? demoVehicle(q) : await liveVehicle(supabaseAdmin(), q));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
