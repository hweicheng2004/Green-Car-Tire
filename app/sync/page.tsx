// /sync — when the sheet was last synced, what was wrong, and a "Sync now" button.
// The button runs the sync on the server, so the Google key and CRON_SECRET never reach the browser.
import { redirect } from 'next/navigation';
import { syncSheetsFromEnv, syncStatus, type SyncStatusRow } from '@/lib/inventory-sync-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function syncNow(form: FormData) {
  'use server';
  let result: string;
  try {
    const r = await syncSheetsFromEnv('manual', form.get('force') === '1');
    result = [...r.kinds.map(k => `${k.kind}: ${k.status}, ${k.rows} rows, ${k.qty} on hand, ${k.rejected} not synced${k.message ? `. ${k.message}` : ''}`),
      `Sync issues tab: ${r.issuesTab}`].join('\n');
  } catch (e) {
    result = `Sync failed: ${(e as Error).message}`;
  }
  redirect(`/sync?result=${encodeURIComponent(result)}`);
}

const tz = process.env.SHOP_TIMEZONE || 'America/Toronto';
const when = (iso?: string | null) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  return `${new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))} (${ago})`;
};

const colour = { ok: '#1d7a3a', blocked: '#9a5b00', error: '#b3261e' } as const;
const box = { background: '#fff', border: '1px solid #dde1dc', borderRadius: 8, padding: 16, marginBottom: 12 };

function Kind({ name, latest, lastOk }: { name: string; latest: SyncStatusRow | null; lastOk: SyncStatusRow | null }) {
  return (
    <section style={box}>
      <h2 style={{ fontSize: 17, margin: '0 0 8px' }}>
        {name}{' '}
        {latest && <span style={{ color: colour[latest.status], fontSize: 14 }}>{latest.status === 'ok' ? 'up to date' : latest.status}</span>}
      </h2>
      {!latest && <p style={{ margin: 0 }}>Never synced.</p>}
      {latest && latest.status !== 'ok' && <p style={{ margin: '0 0 8px', color: colour[latest.status] }}>{latest.message}</p>}
      {lastOk && (
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          Counter shows the sync from {when(lastOk.synced_at)}: {lastOk.rows_synced} rows, {lastOk.qty_on_hand} on hand
          {lastOk.rejected ? `, ${lastOk.rejected} rows not synced` : ''}{lastOk.warnings ? `, ${lastOk.warnings} to check` : ''}.
          <br />Tabs: {lastOk.tabs.join(', ')}. Sheet last checked {when(latest?.checked_at)}.
        </p>
      )}
    </section>
  );
}

export default async function SyncPage({ searchParams }: { searchParams: { result?: string } }) {
  let status: Awaited<ReturnType<typeof syncStatus>> | null = null, loadError = '';
  try { status = await syncStatus(); } catch (e) { loadError = (e as Error).message; }
  const blocked = status && Object.values(status).some(s => s.latest?.status === 'blocked');
  const btn = { font: 'inherit', padding: '10px 18px', borderRadius: 6, border: '1px solid #1d7a3a', cursor: 'pointer' };

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Inventory sync</h1>
      <p style={{ margin: '0 0 16px', color: '#555' }}>
        The counter reads a copy of the Google Sheet, refreshed every 5 minutes. Rows it couldn't read are listed on the
        sheet's &quot;{process.env.SHEETS_ISSUES_TAB || 'Sync issues'}&quot; tab.
      </p>
      {loadError && <p style={{ ...box, color: colour.error }}>Can't read sync status: {loadError}</p>}
      {status && <><Kind name="Tires" {...status.tires} /><Kind name="Wheels" {...status.wheels} /></>}

      <form action={syncNow} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
        <button style={{ ...btn, background: '#1d7a3a', color: '#fff' }}>Sync now</button>
        {blocked && <button name="force" value="1" style={{ ...btn, background: '#fff', color: '#9a5b00', borderColor: '#9a5b00' }}>Sync anyway</button>}
      </form>

      {searchParams.result && (
        <section style={{ ...box, whiteSpace: 'pre-line', lineHeight: 1.6 }}>
          <strong>Last button press</strong>{'\n'}{searchParams.result}
        </section>
      )}
    </main>
  );
}
