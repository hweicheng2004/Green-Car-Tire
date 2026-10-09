// First-time setup once demo mode is off: what's missing, and loading a spreadsheet straight into Supabase.
// Used by the /setup page. Loading runs the same cleaner as the Sheets sync on the server (the browser only sends
// the cells), replaces the table in one transaction, and logs it like a sync so the counter shows when stock arrived.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanTab, planKind, type KindPlan } from './inventory-sync';
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
  problems: { row: number; msg: string; cells: string }[];
};

const preview = (plan: KindPlan, headerRow: number, problems: LoadPreview['problems']): LoadPreview =>
  ({ kind: plan.kind, rows: plan.rows.length, qty: plan.qty, rejected: plan.rejected, warnings: plan.warnings, block: plan.block, headerRow, problems });

/** Cleans the cells; with dryRun false and nothing blocking, replaces the whole table. */
export async function loadSheet(db: SupabaseClient, kind: Kind, source: string, cells: string[][], dryRun: boolean): Promise<LoadPreview & { loaded: boolean }> {
  const tab = cleanTab(source, kind, cells);
  // First setup replaces everything on purpose, so the big-drop guard (meant for the 5-minute sync) is off.
  const plan = planKind(kind, [source], [tab], [], 'setup', 0, true);
  const problems = tab.cleaned.filter(c => !c.row && !c.skipped).slice(0, 50)
    .map(c => ({ row: c.sourceRow, msg: c.issues.filter(i => i.level === 'error').map(i => i.msg).join('; '), cells: Object.values(c.raw).join(' · ') }));
  const out = preview(plan, tab.headerRow, problems);
  if (dryRun || plan.block) return { ...out, loaded: false };
  const store = supabaseSyncStore(db);
  await store.replace(kind, plan.rows);
  await store.log({ trigger: 'manual', kind, tabs: [source], status: 'ok', rows_synced: plan.rows.length, qty_on_hand: plan.qty,
    rejected: plan.rejected, warnings: plan.warnings, content_hash: null, message: 'Loaded from /setup' });
  return { ...out, loaded: true };
}
