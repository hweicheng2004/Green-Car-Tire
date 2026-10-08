// Shape and rules for the counter search log. Shared by the API route (server) and the dashboard (client).

export type SearchOutcome = 'in_stock' | 'used_only' | 'alternate_only' | 'special_order' | 'no_fitment' | 'no_match';

export type CounterSearch = {
  kind: 'vehicle' | 'size';
  query: string;
  year?: number | null;
  makeSlug?: string | null;
  modelSlug?: string | null;
  tireSize?: string | null;
  oeSizes?: string[];
  exactInStock?: number;
  newInStock?: number;
  altInStock?: number;
  wheelsInStock?: number | null;
  fitmentSource?: 'cache' | 'api' | 'stale' | 'none';
  station?: string | null;
  staff?: string | null;
};

/** Same order of questions the counter tech asks: new on the shelf? used? an alternate? else order it. */
export function classify(s: Pick<CounterSearch, 'kind' | 'tireSize' | 'exactInStock' | 'newInStock' | 'altInStock'> & { matched: boolean }): SearchOutcome {
  if (!s.matched) return 'no_match';
  if (!s.tireSize) return 'no_fitment';
  if ((s.newInStock ?? 0) > 0) return 'in_stock';
  if ((s.exactInStock ?? 0) > 0) return 'used_only';
  if ((s.altInStock ?? 0) > 0) return 'alternate_only';
  return 'special_order';
}

const SIZE = /^\d{3}\/\d{2}R\d{2}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,49}$/;
const int = (v: unknown, max = 9999) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Validates a POST body into a DB row. Returns an error string instead of throwing. */
export function toRow(body: unknown): { row: Record<string, unknown> } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be a JSON object.' };
  const b = body as Record<string, unknown>;
  const kind = b.kind === 'vehicle' || b.kind === 'size' ? b.kind : null;
  const query = str(b.query, 80);
  if (!kind || !query) return { error: 'kind ("vehicle" or "size") and query are required.' };

  const tireSize = typeof b.tireSize === 'string' && SIZE.test(b.tireSize) ? b.tireSize : null;
  const makeSlug = typeof b.makeSlug === 'string' && SLUG.test(b.makeSlug) ? b.makeSlug : null;
  const modelSlug = typeof b.modelSlug === 'string' && SLUG.test(b.modelSlug) ? b.modelSlug : null;
  const oeSizes = Array.isArray(b.oeSizes) ? b.oeSizes.filter((x): x is string => typeof x === 'string' && SIZE.test(x)).slice(0, 12) : null;
  const exact = int(b.exactInStock) ?? 0, fresh = int(b.newInStock) ?? 0, alt = int(b.altInStock) ?? 0;
  const matched = kind === 'size' ? !!tireSize : !!(makeSlug && modelSlug);
  const src = ['cache', 'api', 'stale', 'none'].includes(b.fitmentSource as string) ? b.fitmentSource : null;

  return {
    row: {
      kind, query,
      year: int(b.year, 2100),
      make_slug: makeSlug, model_slug: modelSlug,
      tire_size: tireSize, oe_sizes: oeSizes,
      exact_in_stock: exact, new_in_stock: Math.min(fresh, exact), alt_in_stock: alt,
      wheels_in_stock: kind === 'vehicle' ? int(b.wheelsInStock) : null,
      outcome: classify({ kind, tireSize, exactInStock: exact, newInStock: fresh, altInStock: alt, matched }),
      fitment_source: src,
      station: str(b.station, 40), staff: str(b.staff, 40),
    },
  };
}
