// First-time setup once demo mode is off: what's missing, and loading a spreadsheet straight into Supabase.
// Used by the /setup page. Loading runs the same cleaner as the Sheets sync on the server (the browser only sends
// the cells), replaces the table in one transaction, and logs it like a sync so the counter shows when stock arrived.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanTab, planKind } from './inventory-sync';
import { supabaseSyncStore } from './inventory-sync-store';
import { isMissingTable } from './db-errors';
import type { Kind } from './inventory-clean';

export const SETUP_TABLES = ['vehicle_models', 'vehicle_fitment', 'fitment_oe_sizes', 'counter_searches', 'tires', 'wheels', 'shop_settings', 'inventory_syncs'] as const;
export const MAX_SETUP_ROWS = 20000;

export type SetupStatus = {
  supabase: boolean; missingTables: string[]; error: string | null;
  tires: number; wheels: number; models: number;
  googleSheet: boolean; wheelSize: boolean; anthropic: boolean; password: boolean;
};

export async function setupStatus(db: SupabaseClient | null, env: Record<string, string | undefined> = process.env): Promise<SetupStatus> {
  const base = { googleSheet: !!(env.GOOGLE_SHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON), wheelSize: !!env.WHEELSIZE_API_KEY,
    anthropic: !!env.ANTHROPIC_API_KEY, password: !!env.ADMIN_PASSWORD };
  if (!db) return { ...base, supabase: false, missingTables: [...SETUP_TABLES], error: null, tires: 0, wheels: 0, models: 0 };
  const counts = await Promise.all(SETUP_TABLES.map(async t => {
    // A normal one-row read, not a HEAD request: HEAD responses have no body, so "table not found" would look like success.
    const r = await db.from(t).select('*', { count: 'exact' }).limit(1);
    return { t, n: r.count ?? 0, missing: !!r.error && (isMissingTable(r.error) || r.status === 404), error: r.error && !isMissingTable(r.error) && r.status !== 404 ? r.error.message || `Supabase returned ${r.status}` : null };
  }));
  const n = (t: string) => counts.find(c => c.t === t)?.n ?? 0;
  return { ...base, supabase: true, missingTables: counts.filter(c => c.missing).map(c => c.t), error: counts.find(c => c.error)?.error ?? null,
    tires: n('tires'), wheels: n('wheels'), models: n('vehicle_models') };
}

export type LoadPreview = {
  kind: Kind; rows: number; qty: number; rejected: number; warnings: number; block: string | null; headerRow: number;
  problems: { row: number; tab: string; msg: string; cells: string }[];
  gone: number;   // sold, returned, scrapped... left out
  tabs: { source: string; rows: number; qty: number; rejected: number; gone: number; missing: string[] }[];
};
export type SheetCells = { source: string; cells: string[][] };

const isGone = (c: { skipped?: boolean; issues: { field: string }[] }) => !!c.skipped && c.issues.some(i => i.field === 'status');

/** One tab. Same as loadSheets with a single sheet. */
export const loadSheet = (db: SupabaseClient, kind: Kind, source: string, cells: string[][], dryRun: boolean) =>
  loadSheets(db, kind, [{ source, cells }], dryRun);

/** Cleans every tab (a workbook often splits stock: Used Tires, New tires, Singles); with dryRun false and nothing
 *  blocking, replaces the whole table with all of them in one transaction. */
export async function loadSheets(db: SupabaseClient, kind: Kind, sheets: SheetCells[], dryRun: boolean): Promise<LoadPreview & { loaded: boolean }> {
  const results = sheets.map(sh => cleanTab(sh.source, kind, sh.cells));
  const names = sheets.map(sh => sh.source);
  // First setup replaces everything on purpose, so the big-drop guard (meant for the 5-minute sync) is off.
  const plan = planKind(kind, names, results, [], 'setup', 0, true);
  const problems = results.flatMap(t => t.cleaned.filter(c => !c.row && !c.skipped).map(c => ({ row: c.sourceRow, tab: t.tab,
    msg: c.issues.filter(i => i.level === 'error').map(i => i.msg).join('; '), cells: Object.values(c.raw).join(' · ') }))).slice(0, 80);
  const tabs = results.map(t => {
    const ok = t.cleaned.filter(c => c.row);
    return { source: t.tab, rows: ok.length, qty: ok.reduce((n, c) => n + ((c.row as { qty: number }).qty || 0), 0),
      rejected: t.cleaned.filter(c => !c.row && !c.skipped).length, gone: t.cleaned.filter(isGone).length, missing: t.missing };
  });
  const out: LoadPreview = { kind, rows: plan.rows.length, qty: plan.qty, rejected: plan.rejected, warnings: plan.warnings, block: plan.block,
    headerRow: results[0]?.headerRow ?? 0, problems, gone: tabs.reduce((n, t) => n + t.gone, 0), tabs };
  if (dryRun || plan.block) return { ...out, loaded: false };
  const store = supabaseSyncStore(db);
  await store.replace(kind, plan.rows);
  await store.log({ trigger: 'manual', kind, tabs: names, status: 'ok', rows_synced: plan.rows.length, qty_on_hand: plan.qty,
    rejected: plan.rejected, warnings: plan.warnings, content_hash: null, message: 'Loaded from /setup' });
  return { ...out, loaded: true };
}
