// Supabase side of the inventory sync (see lib/inventory-sync.ts). Server-only: uses the service role.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase-admin';
import { sheetsClient, serviceAccount, SheetsError } from './google-sheets';
import { runSync, syncConfig, type SyncStore, type LastSync } from './inventory-sync';

export function supabaseSyncStore(db: SupabaseClient): SyncStore {
  const must = <T>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async lastSync(kind) {
      return must(await db.from('inventory_syncs').select('id, status, content_hash, message')
        .eq('kind', kind).order('id', { ascending: false }).limit(1).maybeSingle()) as LastSync | null;
    },
    async count(kind) {
      const r = await db.from(kind).select('*', { count: 'exact', head: true });
      if (r.error) throw new Error(r.error.message);
      return r.count ?? 0;
    },
    async replace(kind, rows) {
      return must(await db.rpc('replace_inventory', { p_kind: kind, p_rows: rows })) as number;
    },
    async log(rec) {
      must(await db.from('inventory_syncs').insert(rec));
    },
    async touch(id) {
      must(await db.from('inventory_syncs').update({ checked_at: new Date().toISOString() }).eq('id', id));
    },
  };
}

// ---------------------------------------------------------------- wiring from env, shared by the route and the /sync page
export async function syncSheetsFromEnv(trigger: 'cron' | 'manual', force = false) {
  const id = process.env.GOOGLE_SHEET_ID?.trim();
  if (!id) throw new SheetsError(500, 'GOOGLE_SHEET_ID is not set. It is the long ID in the sheet URL, between /d/ and /edit.');
  return runSync({ sheets: sheetsClient(id, serviceAccount()), store: supabaseSyncStore(supabaseAdmin()), config: syncConfig(), trigger, force });
}

export type SyncStatusRow = {
  kind: 'tires' | 'wheels'; status: LastSync['status']; synced_at: string; checked_at: string; trigger: string; tabs: string[];
  rows_synced: number | null; qty_on_hand: number | null; rejected: number | null; warnings: number | null; message: string | null;
};

/** Latest sync row per kind, plus the last successful one (the counter's data is from that one). */
export async function syncStatus(db = supabaseAdmin()) {
  const cols = 'kind, status, synced_at, checked_at, trigger, tabs, rows_synced, qty_on_hand, rejected, warnings, message';
  const out: Record<string, { latest: SyncStatusRow | null; lastOk: SyncStatusRow | null }> = {};
  for (const kind of ['tires', 'wheels'] as const) {
    const [latest, lastOk] = await Promise.all([
      db.from('inventory_syncs').select(cols).eq('kind', kind).order('id', { ascending: false }).limit(1).maybeSingle(),
      db.from('inventory_syncs').select(cols).eq('kind', kind).eq('status', 'ok').order('id', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (latest.error) throw new Error(latest.error.message);
    out[kind] = { latest: latest.data as SyncStatusRow | null, lastOk: lastOk.data as SyncStatusRow | null };
  }
  return out as Record<'tires' | 'wheels', { latest: SyncStatusRow | null; lastOk: SyncStatusRow | null }>;
}
