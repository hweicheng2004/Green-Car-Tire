// /sync — when the sheet was last synced, what was wrong, and a "Sync now" button.
// The button runs the sync on the server, so the Google key and CRON_SECRET never reach the browser.
import { redirect } from 'next/navigation';
import { syncSheetsFromEnv, syncStatus, type SyncStatusRow } from '@/lib/inventory-sync-store';
import { isDemo, demoIssueSheet } from '@/lib/demo';

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

// Demo mode: no Google or Supabase. Shows what a sync of the demo sheet produces, including its "Sync issues" tab.
function DemoSync() {
  const { plans, sheet } = demoIssueSheet();
  const head = sheet.findIndex(r => r[0] === 'Tab');
  const cell = { padding: '6px 8px', borderBottom: '1px solid #dde1dc', textAlign: 'left' as const, verticalAlign: 'top' as const };
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px', background: '#f6f7f5', color: '#1b1f1c', minHeight: '100vh' }}>
      <p style={{ margin: '0 0 12px' }}><a href="/">← Counter</a> · <a href="/import">Import a spreadsheet</a></p>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Inventory sync <span style={{ color: colour.blocked, fontSize: 15 }}>demo mode</span></h1>
      <p style={{ margin: '0 0 16px', color: '#555', lineHeight: 1.5 }}>
        No accounts are connected, so the counter is reading the built-in demo sheet (<code>demo/demo-inventory.json</code>, the same cells as
        the demo Google Sheet) through the real sheet cleaner. Connect Supabase and a Google Sheet to sync live stock every 5 minutes.
      </p>
      {plans.map(p => (
        <section key={p.kind} style={box}>
          <h2 style={{ fontSize: 17, margin: '0 0 8px' }}>{p.kind === 'tires' ? 'Tires' : 'Wheels'}</h2>
          <p style={{ margin: 0 }}>{p.rows.length} rows on the counter, {p.qty} on hand. {p.rejected} not synced, {p.warnings} to check.</p>
        </section>
      ))}
      <section style={{ ...box, overflowX: 'auto' }}>
        <h2 style={{ fontSize: 17, margin: '0 0 8px' }}>&quot;Sync issues&quot; tab, as the sync would write it</h2>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead><tr>{sheet[head].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
          <tbody>{sheet.slice(head + 1).map((r, i) => (
            <tr key={i} style={{ color: r[2] === 'Not synced' ? colour.error : undefined }}>{r.map((c, j) => <td key={j} style={cell}>{c}</td>)}</tr>
          ))}</tbody>
        </table>
      </section>
    </main>
  );
}

export default async function SyncPage({ searchParams }: { searchParams: { result?: string } }) {
  if (isDemo()) return <DemoSync />;
  let status: Awaited<ReturnType<typeof syncStatus>> | null = null, loadError = '';
  try { status = await syncStatus(); } catch (e) { loadError = (e as Error).message; }
  const blocked = status && Object.values(status).some(s => s.latest?.status === 'blocked');
  const btn = { font: 'inherit', padding: '10px 18px', borderRadius: 6, border: '1px solid #1d7a3a', cursor: 'pointer' };

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', background: '#f6f7f5', color: '#1b1f1c', minHeight: '100vh' }}>
      <p style={{ margin: '0 0 12px' }}><a href="/">← Counter</a></p>
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
