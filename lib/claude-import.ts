// Claude fixes the spreadsheet rows the rule-based cleaner (lib/inventory-clean.ts) couldn't read.
// Claude never writes SQL: it returns structured rows (JSON schema output), every row is checked against the same
// rules as the database constraints (migration 003), and lib/inventory-clean.ts toSql() writes the SQL.
// So a bad answer can only reject a row, never run something unexpected.
import Anthropic from '@anthropic-ai/sdk';
import { parseTireSize, parseBoltPatterns, type Kind, type Issue, type Cleaned, type TireRow, type WheelRow } from './inventory-clean';

export const MODEL = 'claude-opus-5-5';
export const CHUNK_ROWS = 60;          // rows per request; chunks run in parallel
export const MAX_ROWS = 1500;          // per import, to keep one paste from running up a big bill
const CONCURRENCY = 4;

// ---------------------------------------------------------------- output schema
const n = (type: 'integer' | 'number') => ({ anyOf: [{ type }, { type: 'null' }] });
const s = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const en = (vals: string[]) => ({ anyOf: [{ type: 'string', enum: vals }, { type: 'null' }] });
const b = { anyOf: [{ type: 'boolean' }, { type: 'null' }] };

const ROW_COMMON = {
  source_row: { type: 'integer', description: 'The sheet row number given for this row' },
  action: { type: 'string', enum: ['import', 'skip'], description: 'skip = not an inventory line (title, subtotal, blank, note) or unreadable' },
  note: { type: 'string', description: 'One short sentence: what you changed or assumed, or why skipped' },
};
const TIRE_FIELDS = {
  size: { ...s, description: 'Metric size as 225/65R17 (no P/LT prefix). null if not a metric size' },
  is_lt: b, brand: s, model: s,
  season: en(['W', 'AW', 'AS', 'S']), condition: en(['new', 'used']),
  tread_32nds: n('integer'), load_index: n('integer'), load_index_dual: n('integer'), speed_rating: s, is_xl: b,
  dot_year: n('integer'), qty: n('integer'), price: n('number'), location: s, notes: s,
};
const WHEEL_FIELDS = {
  wheel_type: en(['alloy', 'steel']), condition: en(['new', 'used']), grade: en(['A', 'B', 'C']),
  diameter: n('number'), width: n('number'), bolt_pattern: s, bolt_pattern_alt: s, center_bore: n('number'),
  wheel_offset: n('integer'), description: s, finish: s, lug_seat: en(['conical', 'ball', 'flat']), has_tpms: b,
  qty: n('integer'), price: n('number'), location: s, notes: s,
};

export function outputSchema(kind: Kind) {
  const fields = { ...ROW_COMMON, ...(kind === 'tires' ? TIRE_FIELDS : WHEEL_FIELDS) };
  return {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: { type: 'object', properties: fields, required: Object.keys(fields), additionalProperties: false },
      },
    },
    required: ['rows'],
    additionalProperties: false,
  };
}

// ---------------------------------------------------------------- prompt (stable, so it caches across chunks)
const SYSTEM = `You clean rows from a tire shop's inventory spreadsheet so they can be loaded into a database.
Staff type these sheets by hand: sizes are written many ways, columns get mixed up, prices are sometimes per set,
and some rows are titles, subtotals or notes rather than stock.

Return exactly one output row per input row, with the same source_row.
- action "import" for a real stock line you can read; "skip" for anything else, with the reason in note.
- Never invent values. If a value isn't in the row, use null. A qty you can't read means skip.
- Prices are per tire or per wheel. Convert a set price ("$300/set", "set of 4 $1100") to the per-unit price.
- note: one short sentence on what you changed or assumed, e.g. "Price $300/set read as $75 per tire".
- A status column saying Sold, Returned, Scrapped, Waiting to return or similar means it isn't stock: skip it.
  Reserved, Available or Status Unknown are stock; put a status other than Available in notes.
- A "Status" column is not new/used. A "Type" column of Set / Pair / Single / Package is not the season.
- A price column on a purchasing sheet (with supplier, PO or invoice columns) is what the shop paid: price null,
  and "Cost $X" in notes. Only a selling price goes in price.
- The tab name says a lot: a "Used Tires" or "Singles" tab is used stock unless a row says new.
- location: join the location-like columns (container, rack, area, shelf), e.g. "NYK3 · Left Front".

Tires:
- size: metric "WWW/AAR DD" written as 225/65R17. "225 65 17", "2256517", "P225/65ZR17" are all 225/65R17.
  Flotation sizes like 31x10.50R15 are not metric: size null and action skip.
- is_lt true for LT sizes or LT/10-ply construction. season: W winter/snow/ice, AW all-weather (3PMSF all-season
  like CrossClimate), AS all-season or all-terrain, S summer. Use the brand and model name if the season column is blank.
- condition "used" for used, takeoff, U; tread_32nds from "7/32" or "7"; mm tread to 32nds (1 mm ≈ 1.26/32).
- load_index / speed_rating from "102T", "104R XL", "120/116S" (load_index 120, load_index_dual 116). is_xl from XL/extra load.
- dot_year: the 4-digit year. A DOT week-year code like 2525 means week 25 of 2025; "0525" is 2025.

Wheels:
- diameter and width from "17x7", "7Jx18" (width 7, diameter 18), "16 x 6.5". wheel_offset from "ET45", "+45".
- bolt_pattern as "5x114.3". Inch patterns: 5x4.5 = 5x114.3, 6x5.5 = 6x139.7, 5x5 = 5x127, 5x4.75 = 5x120.7.
  Dual-drilled "5x100/5x114.3": first in bolt_pattern, second in bolt_pattern_alt.
- center_bore in mm. wheel_type steel or alloy (OEM alloy, aftermarket = alloy). grade A/B/C only for used wheels.
- One cell often holds the whole wheel as diameter / bolt pattern / bore: "18/5x112/66.6" is diameter 18,
  5x112, bore 66.6; "18/5x108/114.3/72.6" is dual-drilled 5x108 and 5x114.3. A "?" means unknown: null.
- NOS (new old stock) is new.`;

const tsv = (cells: string[]) => cells.map(c => String(c ?? '').replace(/[\t\n\r]+/g, ' ').trim()).join('\t');

export function chunkPrompt(kind: Kind, headers: string[], rows: { sourceRow: number; cells: string[] }[], tab = '') {
  return `These are ${kind} rows${tab ? ` from the tab "${tab.replace(/["\n]/g, ' ').slice(0, 60)}"` : ''}. Columns (tab-separated):\nrow\t${tsv(headers)}\n\n` +
    rows.map(r => `${r.sourceRow}\t${tsv(r.cells)}`).join('\n');
}

// ---------------------------------------------------------------- validation: the same rules as the database
type Raw = Record<string, unknown>;
const int = (v: unknown, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null);
const numIn = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const one = <T extends string>(v: unknown, vals: readonly T[]) => (vals.includes(v as T) ? (v as T) : null);
const money = (v: unknown) => { const x = numIn(v, 0, 100000); return x === null ? null : Math.round(x * 100) / 100; };

export function validateTire(o: Raw): { row: TireRow | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const size = parseTireSize(o.size);
  if (!size) issues.push({ field: 'size', level: 'error', msg: `Size "${o.size ?? ''}" isn't a metric tire size` });
  const qty = int(o.qty, 0, 100000);
  if (qty === null) issues.push({ field: 'qty', level: 'error', msg: 'No readable quantity' });
  const sr = str(o.speed_rating, 1)?.toUpperCase() ?? null;
  const row: TireRow | null = size && qty !== null ? {
    tire_size: size.size, section_width: size.width, aspect_ratio: size.aspect, rim_diameter: size.rim,
    is_lt: o.is_lt === true || size.isLt, brand: str(o.brand), model: str(o.model),
    season: one(o.season, ['W', 'AW', 'AS', 'S'] as const), condition: one(o.condition, ['new', 'used'] as const) ?? 'new',
    tread_32nds: int(o.tread_32nds, 0, 32), load_index: int(o.load_index, 60, 160), load_index_dual: int(o.load_index_dual, 60, 160),
    speed_rating: sr && /^[A-Z]$/.test(sr) ? sr : null, is_xl: o.is_xl === true, dot_year: int(o.dot_year, 1990, 2100),
    qty, price: money(o.price), location: str(o.location), notes: str(o.notes, 500),
  } : null;
  if (row && o.condition == null) issues.push({ field: 'condition', level: 'warn', msg: 'New/used not given; set to new' });
  return { row, issues };
}

export function validateWheel(o: Raw): { row: WheelRow | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const bolts = parseBoltPatterns(o.bolt_pattern);
  const alt = parseBoltPatterns(o.bolt_pattern_alt)[0] ?? bolts[1] ?? null;
  const diameter = numIn(o.diameter, 12, 26);
  if (diameter === null) issues.push({ field: 'diameter', level: 'error', msg: `Diameter "${o.diameter ?? ''}" isn't 12 to 26 inches` });
  if (!bolts.length) issues.push({ field: 'boltPattern', level: 'error', msg: `Bolt pattern "${o.bolt_pattern ?? ''}" not readable` });
  const qty = int(o.qty, 0, 100000);
  if (qty === null) issues.push({ field: 'qty', level: 'error', msg: 'No readable quantity' });
  const condition = one(o.condition, ['new', 'used'] as const) ?? 'new';
  const row: WheelRow | null = diameter !== null && bolts.length && qty !== null ? {
    wheel_type: one(o.wheel_type, ['alloy', 'steel'] as const) ?? 'alloy', condition,
    grade: condition === 'used' ? one(o.grade, ['A', 'B', 'C'] as const) : null,
    diameter, width: numIn(o.width, 3, 14), bolt_pattern: bolts[0], bolt_pattern_alt: alt && alt !== bolts[0] ? alt : null,
    center_bore: numIn(o.center_bore, 40, 180), wheel_offset: int(o.wheel_offset, -80, 80),
    description: str(o.description), finish: str(o.finish), lug_seat: one(o.lug_seat, ['conical', 'ball', 'flat'] as const),
    has_tpms: typeof o.has_tpms === 'boolean' ? o.has_tpms : null, qty, price: money(o.price), location: str(o.location), notes: str(o.notes, 500),
  } : null;
  if (row && row.center_bore === null) issues.push({ field: 'centerBore', level: 'warn', msg: 'No center bore. Measure it.' });
  return { row, issues };
}

/** Claude's answer for a chunk -> the same Cleaned shape the rule-based cleaner produces. Missing rows are reported, not dropped silently. */
export function toCleaned(kind: Kind, input: { sourceRow: number; cells: string[] }[], headers: string[], out: Raw[]): Cleaned<TireRow | WheelRow>[] {
  const byRow = new Map(out.map(o => [Number(o.source_row), o]));
  return input.map(({ sourceRow, cells }) => {
    const raw = Object.fromEntries(headers.map((h, i) => [h || `col${i + 1}`, String(cells[i] ?? '').trim()]).filter(([, v]) => v));
    const o = byRow.get(sourceRow);
    if (!o) return { sourceRow, raw, row: null, issues: [{ field: 'claude', level: 'error', msg: 'Claude returned nothing for this row' }] };
    const note = str(o.note, 300);
    if (o.action === 'skip') return { sourceRow, raw, row: null, skipped: true, issues: note ? [{ field: 'claude', level: 'warn', msg: `Skipped: ${note}` }] : [] };
    const v = kind === 'tires' ? validateTire(o) : validateWheel(o);
    const issues: Issue[] = [...(note ? [{ field: 'claude', level: 'warn' as const, msg: `Claude: ${note}` }] : []), ...v.issues];
    return { sourceRow, raw, row: v.row, issues };
  });
}

// ---------------------------------------------------------------- the API call
export type ImportUsage = { input: number; output: number; cacheRead: number; requests: number };

async function runChunk(client: Anthropic, kind: Kind, headers: string[], rows: { sourceRow: number; cells: string[] }[], usage: ImportUsage, tab = '') {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',                       // a declined request is re-run on Anthropic's recommended fallback model
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: outputSchema(kind) } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: chunkPrompt(kind, headers, rows, tab) }],
  });
  const msg = await stream.finalMessage();
  usage.requests++;
  usage.input += msg.usage.input_tokens;
  usage.output += msg.usage.output_tokens;
  usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined these rows.');
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude ran out of room on these rows. Try fewer rows at a time.');
  const text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  const parsed = JSON.parse(text) as { rows?: Raw[] };
  return toCleaned(kind, rows, headers, parsed.rows ?? []);
}

/** Splits the rows into chunks, runs them a few at a time, and returns every row in sheet order. */
export async function cleanWithClaude(kind: Kind, headers: string[], rows: { sourceRow: number; cells: string[] }[], client = new Anthropic(), tab = '') {
  if (rows.length > MAX_ROWS) throw new Error(`Send at most ${MAX_ROWS} rows at a time (got ${rows.length}).`);
  const chunks: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) chunks.push(rows.slice(i, i + CHUNK_ROWS));
  const usage: ImportUsage = { input: 0, output: 0, cacheRead: 0, requests: 0 };
  const results: Cleaned<TireRow | WheelRow>[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      try {
        results[i] = await runChunk(client, kind, headers, chunks[i], usage, tab);
      } catch (e) {
        // One failed chunk shouldn't lose the rest: its rows come back rejected with the reason.
        const msg = e instanceof Anthropic.APIError ? `Claude API error ${e.status}: ${e.message}` : (e as Error).message;
        results[i] = toCleaned(kind, chunks[i], headers, []).map(c => ({ ...c, issues: [{ field: 'claude', level: 'error' as const, msg }] }));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return { cleaned: results.flat(), usage };
}
