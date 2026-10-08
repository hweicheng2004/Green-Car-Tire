// Cached fitment lookup: Supabase first; otherwise Wheel-Size (cdm + usdm), then saved.
// Shared by GET /api/fitment and the counter's vehicle lookup.
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchAllRegions, regionKey, WheelSizeError } from './wheelsize';
import { normalize, type Fitment } from './fitment';

const STALE_DAYS = () => Number(process.env.WHEELSIZE_CACHE_DAYS || 180);
const DAILY_LIMIT = () => Number(process.env.WHEELSIZE_DAILY_LIMIT || 300);  // sandbox plan = 300/day

/** cache: hit · miss: fetched now · stale-quota / stale-error: old cache served because Wheel-Size wasn't usable. */
export type FitmentResult =
  | { fit: Fitment; cache: 'hit' | 'miss' | 'stale-error' }
  | { error: string; status: number };

export async function getFitment(db: SupabaseClient, make: string, model: string, year: number, refresh = false): Promise<FitmentResult> {
  const REGION = regionKey();   // cache key, e.g. "cdm+usdm"
  const { data: cached } = await db.from('vehicle_fitment').select('data, lug_seat, fetched_at')
    .match({ make_slug: make, model_slug: model, year, region: REGION }).maybeSingle();

  const ageDays = cached ? (Date.now() - new Date(cached.fetched_at).getTime()) / 864e5 : Infinity;
  if (cached && ageDays < STALE_DAYS() && !refresh) return { fit: withOverride(cached.data as Fitment, cached.lug_seat), cache: 'hit' };

  // Protect the daily quota: count each call before making it; if over, serve stale cache rather than fail.
  const countHit = async () => {
    const { data: hits } = await db.rpc('wheelsize_hit');
    if (typeof hits === 'number' && hits > DAILY_LIMIT()) throw new WheelSizeError(429, `Wheel-Size daily limit (${DAILY_LIMIT()}) reached. Check the door placard.`);
  };

  try {
    const raw = await searchAllRegions(make, model, year, countHit);
    const fit = normalize(raw, year);
    if (!fit || !fit.oe.length) return { error: `No fitment on file for ${year} ${make} ${model}. Check the door placard.`, status: 404 };
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
    return { fit: withOverride(fit, cached?.lug_seat ?? null), cache: 'miss' };
  } catch (e) {
    if (cached) return { fit: withOverride(cached.data as Fitment, cached.lug_seat), cache: 'stale-error' };
    return { error: (e as Error).message, status: e instanceof WheelSizeError ? e.status : 502 };
  }
}

const withOverride = (f: Fitment, seat: string | null): Fitment =>
  seat ? { ...f, lugSeat: seat as Fitment['lugSeat'] } : f;
