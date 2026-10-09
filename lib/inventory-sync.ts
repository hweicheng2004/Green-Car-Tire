// Google Sheets -> Supabase inventory sync. Reads the tire and wheel tabs, runs the same cleaner as the
// importer page, replaces each table in one transaction, and writes rejected rows to a "Sync issues" tab
// so staff can see what to fix. Used by POST /api/sync/sheets (schedule) and the /sync page (Sync now).
import { createHash } from 'node:crypto';
import { findHeaderRow, autoMap, cleanAll, REQUIRED_FIELDS, FIELD_LABELS,
  type Kind, type Cleaned, type TireRow, type WheelRow } from './inventory-clean';
import type { SheetsClient } from './google-sheets';

export type SyncConfig = { tireTabs: string[]; wheelTabs: string[]; issuesTab: string; timeZone: string };

const list = (v: string | undefined, dflt: string) => (v || dflt).split(',').map(s => s.trim()).filter(Boolean);
export const syncConfig = (env: Record<string, string | undefined> = process.env): SyncConfig => ({
  tireTabs: list(env.SHEETS_TIRE_TABS, 'Tires'),
  wheelTabs: list(env.SHEETS_WHEEL_TABS, 'Wheels'),
  issuesTab: env.SHEETS_ISSUES_TAB?.trim() || 'Sync issues',
  timeZone: env.SHOP_TIMEZONE?.trim() || 'America/Toronto',
});

// A big drop is far more likely a broken sheet (rows deleted, header changed) than a real sell-off.
// Blocked unless someone presses "Sync anyway".
const DROP_GUARD_MIN = 20, DROP_GUARD_RATIO = 0.5;
const ISSUE_ROWS_MAX = 1000;

// ---------------------------------------------------------------- cleaning one tab
export type TabResult = { tab: string; kind: Kind; headerRow: number; missing: string[]; cleaned: Cleaned<TireRow | WheelRow>[] };

export function cleanTab(tab: string, kind: Kind, values: string[][]): TabResult {
  if (!values.some(r => r.some(c => c.trim()))) return { tab, kind, headerRow: 0, missing: ['the tab is empty'], cleaned: [] };
  const h = findHeaderRow(values);
  const headers = values[h].map(String), body = values.slice(h + 1);
  const map = autoMap(headers, kind);
  const missing = REQUIRED_FIELDS[kind].filter(g => !g.some(f => map[f] !== undefined)).map(g => FIELD_LABELS[g[0]]);
  // Sheet rows are 1-based; cleanAll numbers the first body row 2, so shift by the header's position.
  const cleaned = missing.length ? [] : cleanAll(kind, headers, body, map).map(c => ({ ...c, sourceRow: c.sourceRow + h }));
  return { tab, kind, headerRow: h + 1, missing, cleaned };
}

export type InventoryRow = (TireRow | WheelRow) & { source: string; source_row: number; raw: Record<string, string> };

export type KindPlan = {
  kind: Kind; tabs: string[]; hash: string; rows: InventoryRow[];
  qty: number; rejected: number; warnings: number; block: string | null;
};

const label = (k: Kind) => (k === 'tires' ? 'Tires' : 'Wheels');

/** Decides what a sync of one kind would write, and whether it is safe to. */
export function planKind(kind: Kind, tabs: string[], results: TabResult[], missingTabs: string[], hash: string,
  currentCount: number, force: boolean): KindPlan {
  const rows: InventoryRow[] = [];
  let rejected = 0, warnings = 0;
  for (const r of results) for (const c of r.cleaned) {
    if (c.skipped) continue;
    if (!c.row) { rejected++; continue; }
    if (c.issues.length) warnings++;
    rows.push({ ...c.row, source: `${r.tab} tab`, source_row: c.sourceRow, raw: c.raw });
  }
  const qty = rows.reduce((n, r) => n + (r.qty || 0), 0);
  let block: string | null = null;
  if (missingTabs.length) block = `Tab ${missingTabs.map(t => `"${t}"`).join(', ')} not found in the sheet.`;
  else if (results.some(r => r.missing.length)) {
    block = results.filter(r => r.missing.length)
      .map(r => `"${r.tab}": ${r.missing[0] === 'the tab is empty' ? 'the tab is empty' : `no ${r.missing.join(' or ')} column (header found on row ${r.headerRow})`}`).join('; ') + '.';
  } else if (!rows.length) block = `No ${kind} rows could be read, so nothing was changed.`;
  else if (!force && currentCount >= DROP_GUARD_MIN && rows.length < currentCount * DROP_GUARD_RATIO) {
    block = `${label(kind)} would drop from ${currentCount} rows to ${rows.length}. If that's right, press "Sync anyway" on the sync page.`;
  }
  return { kind, tabs, hash, rows, qty, rejected, warnings, block };
}

// ---------------------------------------------------------------- the "Sync issues" tab
export function issueSheet(results: TabResult[], plans: KindPlan[], when: string): string[][] {
  const out: string[][] = [
    ['Sync issues. Rewritten by the counter sync whenever the inventory changes. Fix the rows in the inventory tabs, not here.'],
    ['Last sync', when],
  ];
  for (const p of plans) {
    out.push([`${label(p.kind)} (${p.tabs.join(', ')})`, p.block
      ? `NOT SYNCED: ${p.block} The counter still shows the last good sync.`
      : `${p.rows.length} rows synced, ${p.qty} on hand. ${p.rejected} not synced, ${p.warnings} to check.`]);
  }
  out.push([]);
  type Line = { err: boolean; tab: string; row: number; cells: string[] };
  const lines: Line[] = [];
  for (const r of results) for (const c of r.cleaned) {
    if (c.skipped || !c.issues.length) continue;
    const err = !c.row;
    const msgs = c.issues.filter(i => (err ? i.level === 'error' : true)).map(i => i.msg).join('; ');
    lines.push({ err, tab: r.tab, row: c.sourceRow,
      cells: [r.tab, String(c.sourceRow), err ? 'Not synced' : 'Synced, check', msgs, Object.values(c.raw).join('  ·  ')] });
  }
  if (!lines.length) { out.push(['No problems found.']); return out; }
  lines.sort((a, b) => Number(b.err) - Number(a.err) || a.tab.localeCompare(b.tab) || a.row - b.row);
  out.push(['Tab', 'Row', 'Status', 'Problem', 'What the row says']);
  for (const l of lines.slice(0, ISSUE_ROWS_MAX)) out.push(l.cells);
  if (lines.length > ISSUE_ROWS_MAX) out.push([`…and ${lines.length - ISSUE_ROWS_MAX} more.`]);
  return out;
}

// ---------------------------------------------------------------- running a sync
export type LastSync = { id: number; status: 'ok' | 'blocked' | 'error'; content_hash: string | null; message: string | null };
export type SyncLog = {
  trigger: 'cron' | 'manual'; kind: Kind; tabs: string[]; status: LastSync['status'];
  rows_synced?: number; qty_on_hand?: number; rejected?: number; warnings?: number; content_hash?: string | null; message?: string | null;
};

/** The database side of a sync. Supabase in production (lib/inventory-sync-store.ts), Postgres in tests. */
export interface SyncStore {
  lastSync(kind: Kind): Promise<LastSync | null>;
  count(kind: Kind): Promise<number>;
  replace(kind: Kind, rows: InventoryRow[]): Promise<number>;
  log(rec: SyncLog): Promise<void>;
  touch(id: number): Promise<void>;
}

export type KindReport = {
  kind: Kind; status: 'ok' | 'unchanged' | 'blocked' | 'error';
  rows: number; qty: number; rejected: number; warnings: number; message: string | null;
};
export type SyncReport = { at: string; kinds: KindReport[]; issuesTab: 'written' | 'skipped' | string };

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export async function runSync(opts: {
  sheets: SheetsClient; store: SyncStore; config: SyncConfig;
  trigger: 'cron' | 'manual'; force?: boolean; now?: Date;
}): Promise<SyncReport> {
  const { sheets, store, config, trigger, force = false } = opts;
  const now = opts.now ?? new Date();
  const kinds: [Kind, string[]][] = [['tires', config.tireTabs], ['wheels', config.wheelTabs]];

  // Same failure as last time: just note we checked, so a 5-minute schedule doesn't pile up rows.
  const record = async (rec: SyncLog, last: LastSync | null) => {
    if (last && last.status === rec.status && rec.status !== 'ok' &&
        (last.content_hash ?? null) === (rec.content_hash ?? null) && last.message === (rec.message ?? null)) {
      await store.touch(last.id); return false;
    }
    await store.log(rec); return true;
  };

  let existing: string[], values: Record<string, string[][]>;
  try {
    existing = await sheets.tabs();
    values = await sheets.read([...config.tireTabs, ...config.wheelTabs].filter(t => existing.includes(t)));
  } catch (e) {
    const message = (e as Error).message;
    for (const [kind, tabs] of kinds) await record({ trigger, kind, tabs, status: 'error', message }, await store.lastSync(kind));
    throw e;
  }

  const results: TabResult[] = [], plans: KindPlan[] = [], reports: KindReport[] = [];
  let changed = trigger === 'manual';
  for (const [kind, tabs] of kinds) {
    const present = tabs.filter(t => existing.includes(t));
    const res = present.map(t => cleanTab(t, kind, values[t] ?? []));
    results.push(...res);
    const hash = sha(present.map(t => [t, values[t]]));
    const last = await store.lastSync(kind);
    const unchanged = !force && last?.status === 'ok' && last.content_hash === hash;
    // The row count only feeds the big-drop guard, so an unchanged sheet skips that query.
    const plan = planKind(kind, tabs, res, tabs.filter(t => !existing.includes(t)), hash, unchanged ? 0 : await store.count(kind), force);
    plans.push(plan);
    const base = { kind, rows: plan.rows.length, qty: plan.qty, rejected: plan.rejected, warnings: plan.warnings };

    if (unchanged) {
      await store.touch(last.id);
      reports.push({ ...base, status: 'unchanged', message: null });
      continue;
    }
    const stats = { rows_synced: plan.rows.length, qty_on_hand: plan.qty, rejected: plan.rejected, warnings: plan.warnings, content_hash: hash };
    if (plan.block) {
      if (await record({ trigger, kind, tabs, status: 'blocked', ...stats, message: plan.block }, last)) changed = true;
      reports.push({ ...base, status: 'blocked', message: plan.block });
      continue;
    }
    try {
      await store.replace(kind, plan.rows);
      await store.log({ trigger, kind, tabs, status: 'ok', ...stats, message: null });
      reports.push({ ...base, status: 'ok', message: null });
    } catch (e) {
      const message = `Database write failed: ${(e as Error).message}`;
      await record({ trigger, kind, tabs, status: 'error', ...stats, content_hash: null, message }, last);
      reports.push({ ...base, status: 'error', message });
    }
    changed = true;
  }

  let issuesTab: SyncReport['issuesTab'] = 'skipped';
  if (changed) {
    try {
      if (!existing.includes(config.issuesTab)) await sheets.addTab(config.issuesTab);
      const when = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(now);
      await sheets.replaceTab(config.issuesTab, issueSheet(results, plans, when));
      issuesTab = 'written';
    } catch (e) {
      issuesTab = `failed: ${(e as Error).message}`;   // inventory is already saved; this only affects the report tab
    }
  }
  return { at: now.toISOString(), kinds: reports, issuesTab };
}
