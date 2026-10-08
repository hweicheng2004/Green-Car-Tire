// GET /api/fitment?make=subaru&model=outback&year=2018[&refresh=1]
// Returns the normalized fitment card. Served from Supabase when cached; otherwise Wheel-Size (cdm + usdm),
// then saved. Header x-fitment-cache: hit | miss | stale-quota | stale-error (pass to logSearch as fitmentSource).
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { searchAllRegions, regionKey, WheelSizeError } from '@/lib/wheelsize';
import { normalize, type Fitment } from '@/lib/fitment';

const REGION = regionKey();   // cache key, e.g. "cdm+usdm"
const STALE_DAYS = Number(process.env.WHEELSIZE_CACHE_DAYS || 180);
const DAILY_LIMIT = Number(process.env.WHEELSIZE_DAILY_LIMIT || 300);  // sandbox plan = 300/day

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const make = p.get('make')?.trim().toLowerCase(), model = p.get('model')?.trim().toLowerCase();
  const year = Number(p.get('year')), refresh = p.get('refresh') === '1';
  if (!make || !model || !Number.isInteger(year)) {
    return NextResponse.json({ error: 'make, model and year are required' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: cached } = await db.from('vehicle_fitment').select('data, lug_seat, fetched_at')
    .match({ make_slug: make, model_slug: model, year, region: REGION }).maybeSingle();

  const ageDays = cached ? (Date.now() - new Date(cached.fetched_at).getTime()) / 864e5 : Infinity;
  if (cached && ageDays < STALE_DAYS && !refresh) {
    return NextResponse.json(withOverride(cached.data as Fitment, cached.lug_seat), { headers: { 'x-fitment-cache': 'hit' } });
  }

  // Protect the daily quota: count each call before making it; if over, serve stale cache rather than fail.
  const countHit = async () => {
    const { data: hits } = await db.rpc('wheelsize_hit');
    if (typeof hits === 'number' && hits > DAILY_LIMIT) throw new WheelSizeError(429, `Wheel-Size daily limit (${DAILY_LIMIT}) reached. Check the door placard.`);
  };

  try {
    const raw = await searchAllRegions(make, model, year, countHit);
    const fit = normalize(raw, year);
    if (!fit || !fit.oe.length) {
      return NextResponse.json({ error: `No fitment on file for ${year} ${make} ${model}. Check the door placard.` }, { status: 404 });
    }
    // Save the card, then its sizes as rows (feeds /api/fitment/by-size and the search reports).
    // A failed save is logged but never blocks the quote.
    const { error: saveErr } = await db.from('vehicle_fitment').upsert({
      make_slug: make, model_slug: model, year, region: REGION, data: fit, raw, fetched_at: fit.fetchedAt,
    });
    if (saveErr) console.error('vehicle_fitment save failed', saveErr.message);
    else {
      const { error: syncErr } = await db.rpc('sync_fitment_oe_sizes', { p_make: make, p_model: model, p_year: year, p_region: REGION });
      if (syncErr) console.error('fitment_oe_sizes sync failed', syncErr.message);
    }
    return NextResponse.json(withOverride(fit, cached?.lug_seat ?? null), { headers: { 'x-fitment-cache': 'miss' } });
  } catch (e) {
    if (cached) return NextResponse.json(withOverride(cached.data as Fitment, cached.lug_seat), { headers: { 'x-fitment-cache': 'stale-error' } });
    const status = e instanceof WheelSizeError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

const withOverride = (f: Fitment, seat: string | null): Fitment =>
  seat ? { ...f, lugSeat: seat as Fitment['lugSeat'] } : f;
