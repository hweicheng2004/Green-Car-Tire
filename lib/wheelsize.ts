// Wheel-Size Fitment API v2 client. SERVER-SIDE ONLY: never import this from a client component,
// the key would ship to the browser.
// Docs: https://developer.wheel-size.com/  ·  Spec: https://api.wheel-size.com/v2/openapi.json

const BASE = 'https://api.wheel-size.com/v2';

export type Region = 'cdm' | 'usdm' | 'mxndm';   // Canada, US, Mexico

/** Markets to query, in priority order. Default "cdm,usdm": Wheel-Size tags many Canadian trims
 *  (e.g. 2018 Outback 2.5i) as US-only, and Canadian and US fitment is the same for nearly all cars. */
export const regions = (): Region[] =>
  (process.env.WHEELSIZE_REGIONS || process.env.WHEELSIZE_REGION || 'cdm,usdm')
    .split(',').map(r => r.trim()).filter(Boolean) as Region[];
export const regionKey = () => regions().join('+');

export class WheelSizeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function key(): string {
  const k = process.env.WHEELSIZE_API_KEY;
  if (!k) throw new WheelSizeError(500, 'WHEELSIZE_API_KEY is not set. Add it to .env.local.');
  return k;
}

async function get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  url.searchParams.set('user_key', key());
  const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401 || res.status === 403 ? ' Check the key, or that it has been approved.'
      : res.status === 429 ? ' Daily hit quota reached.' : '';
    throw new WheelSizeError(res.status, `Wheel-Size ${path} returned ${res.status}.${hint} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export type WsSlugName = { slug: string; name: string };
type WsList<T> = { data: T[] };

export const listMakes = (region: Region) =>
  get<WsList<WsSlugName>>('/makes/', { region }).then(r => r.data);

export const listModels = (make: string, region: Region) =>
  get<WsList<WsSlugName>>('/models/', { make, region }).then(r => r.data);

/** Raw search-by-model. One item per modification (trim / engine) sold that year. One hit per call. */
export const searchByModel = (make: string, model: string, year: number, region: Region) =>
  get<WsList<WsModification>>('/search/by_model/', { make, model, year, region, limit: 100 }).then(r => r.data);

/** Every configured market, merged and de-duplicated by modification slug. One hit per region. */
export async function searchAllRegions(make: string, model: string, year: number, onHit?: () => Promise<void>) {
  // Markets are fetched in parallel; merging in region order keeps the first market's record on duplicates.
  const results = await Promise.all(regions().map(async r => { await onHit?.(); return searchByModel(make, model, year, r); }));
  const seen = new Map<string, WsModification>();
  for (const list of results) {
    for (const m of list) {
      const k = m.slug ?? `${m.trim}|${m.name}`;
      if (!seen.has(k)) seen.set(k, m);
    }
  }
  return [...seen.values()];
}

// ---- Response shape (only the fields we use; everything optional so a schema change can't crash the counter) ----
export type WsWheelSide = {
  tire?: string;          // "235/65R17"
  tire_full?: string;     // "235/65R17 104T"
  load_index?: number | string;
  speed_index?: string;
  rim?: string;           // "7Jx17 ET45"
  rim_diameter?: number;
  rim_width?: number;
  rim_offset?: number;
  tire_pressure?: { psi?: number; kPa?: number; bar?: number };
};
export type WsWheelPair = {
  is_stock?: boolean;
  showing_fp_only?: boolean;   // true = same front and rear, rear can be ignored
  is_extra_load_tires?: boolean;
  is_recommended_for_winter?: boolean;
  is_pressed_steel_rims?: boolean;
  front?: WsWheelSide;
  rear?: WsWheelSide;
};
export type WsTechnical = {
  bolt_pattern?: string;       // "5x114.3"
  pcd?: number;
  stud_holes?: number;
  centre_bore?: string | number;
  wheel_fasteners?: { type?: string; thread_size?: string };
  wheel_tightening_torque?: string;  // e.g. "108 Nm"
};
export type WsModification = {
  slug?: string;
  name?: string;
  trim?: string;
  trim_levels?: string[];      // ["Limited", "Touring"]
  regions?: string[];
  start_year?: number;
  end_year?: number;
  make?: WsSlugName;
  model?: WsSlugName;
  generation?: { name?: string; start?: number; end?: number };
  technical?: WsTechnical;
  wheels?: WsWheelPair[];
};
