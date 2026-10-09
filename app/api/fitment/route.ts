// GET /api/fitment?make=subaru&model=outback&year=2018[&refresh=1]
// Returns the normalized fitment card. Served from Supabase when cached; otherwise Wheel-Size (cdm + usdm),
// then saved. Header x-fitment-cache: hit | miss | stale-error (pass to logSearch as fitmentSource).
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getFitment } from '@/lib/fitment-lookup';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const make = p.get('make')?.trim().toLowerCase(), model = p.get('model')?.trim().toLowerCase();
  const year = Number(p.get('year')), refresh = p.get('refresh') === '1';
  if (!make || !model || !Number.isInteger(year)) {
    return NextResponse.json({ error: 'make, model and year are required' }, { status: 400 });
  }
  const r = await getFitment(supabaseAdmin(), make, model, year, refresh);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if ('notCached' in r) return NextResponse.json({ error: 'not cached' }, { status: 404 });
  return NextResponse.json(r.fit, { headers: { 'x-fitment-cache': r.cache } });
}
