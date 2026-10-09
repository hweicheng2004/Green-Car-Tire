'use client';
// /setup — first use after demo mode is off. Walks through: database connected, tables created, tires loaded,
// wheels loaded, optional extras. Spreadsheets are read in the browser and cleaned + loaded on the server.
import { useState } from 'react';
import { readSheetFile, suggestTabs, type Sheet, type TabPick } from '@/components/import/read-sheet';
import type { SetupStatus, LoadPreview } from '@/lib/setup';

type Status = SetupStatus & { demo: boolean };
type Kind = 'tires' | 'wheels';

async function call<T>(url: string, body?: unknown): Promise<T> {
  let pw = sessionStorage.getItem('gct-admin') ?? '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'content-type': 'application/json', ...(pw ? { 'x-admin-password': pw } : {}) }, body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401 && out.error === 'password') {
      sessionStorage.removeItem('gct-admin');
      pw = window.prompt(attempt ? 'Wrong password. Admin password:' : 'Admin password') ?? '';
      if (!pw) throw new Error('Password needed.');
      continue;
    }
    if (!res.ok) throw new Error(out.error || `${url} returned ${res.status}`);
    if (pw) sessionStorage.setItem('gct-admin', pw);
    return out as T;
  }
  throw new Error('Wrong password.');
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <section className={`su-step${done ? ' done' : ''}`}>
      <div className="su-num" aria-hidden="true">{done ? '✓' : n}</div>
      <div className="su-body"><h2>{title}</h2>{children}</div>
    </section>
  );
}

function LoadStep({ kind, n, count, enabled, onLoaded }: { kind: Kind; n: number; count: number; enabled: boolean; onLoaded: () => void }) {
  const label = kind === 'tires' ? 'Tires' : 'Wheels';
  const [book, setBook] = useState<Sheet[] | null>(null);
  const [picks, setPicks] = useState<TabPick[]>([]);
  const [prev, setPrev] = useState<LoadPreview | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const chosen = (ps: TabPick[], sheets: Sheet[]) => ps.filter(p => p.on).map(p => ({ source: sheets[p.i].name, cells: sheets[p.i].rows }));
  async function check(sheets: Sheet[], ps: TabPick[]) {
    setPrev(null); setErr(''); setDone('');
    const list = chosen(ps, sheets);
    if (!list.length) { setErr(`Tick at least one tab with ${kind}.`); return; }
    setBusy('Reading…');
    try { setPrev(await call<LoadPreview>('/api/setup/load', { kind, sheets: list, dryRun: true })); }
    catch (e) { setErr((e as Error).message); }
    setBusy('');
  }
  async function pick(f: File) {
    setErr('');
    try {
      const sheets = await readSheetFile(f);
      if (!sheets.length) throw new Error('That file is empty.');
      // A workbook often splits stock over tabs (Used Tires, New tires, Singles): tick every tab that holds this kind.
      const ps = sheets.length === 1 ? [{ i: 0, name: sheets[0].name, rows: sheets[0].rows.length, on: true, why: '' }] : suggestTabs(sheets, kind);
      setBook(sheets); setPicks(ps); await check(sheets, ps);
    } catch (e) { setErr((e as Error).message); }
  }
  function toggle(i: number) {
    if (!book) return;
    const ps = picks.map(p => (p.i === i ? { ...p, on: !p.on } : p));
    setPicks(ps); check(book, ps);
  }
  async function load() {
    if (!book || !prev) return;
    const list = chosen(picks, book);
    if (count && !window.confirm(`This replaces the ${count} ${kind} rows already loaded with ${prev.rows} from ${list.map(l => `"${l.source}"`).join(', ')}. Continue?`)) return;
    setBusy('Loading…'); setErr('');
    try {
      const r = await call<LoadPreview & { loaded: boolean }>('/api/setup/load', { kind, sheets: list, dryRun: false });
      if (!r.loaded) throw new Error(r.block || 'Nothing was loaded.');
      setDone(`${r.rows} ${kind} loaded (${r.qty} on hand).`); setBook(null); setPrev(null); onLoaded();
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  }

  return (
    <Step n={n} done={count > 0} title={`${label}${count ? `: ${count} rows loaded` : ''}`}>
      <p>Upload your {kind} spreadsheet (CSV or Excel, one header row). In a workbook, every tab with {kind} is loaded together.
        Rows are cleaned the same way as the Google Sheets sync: sizes, brands, prices per set, DOT codes, and sold or
        returned rows are left out. {count ? 'Loading again replaces what is there.' : ''}</p>
      {enabled ? (
        <label className="imp-file">Choose {kind} file
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods" onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
        </label>
      ) : <p className="gen">Finish the steps above first.</p>}
      {book && book.length > 1 && (
        <div className="su-tabs">
          <div className="gen">Tabs to load into {kind}:</div>
          {picks.map(p => (
            <label key={p.i} className={`su-tab${p.on ? ' on' : ''}`}>
              <input type="checkbox" checked={p.on} onChange={() => toggle(p.i)} /> <b>{p.name}</b>
              {p.on && prev ? (() => { const t = prev.tabs.find(x => x.source === p.name); return t ? <span className="gen"> {t.rows} rows, {t.qty} on hand{t.gone ? `, ${t.gone} sold/returned left out` : ''}{t.rejected ? `, ${t.rejected} can't be read` : ''}</span> : null; })()
                : <span className="gen"> {p.why || `${p.rows} rows`}</span>}
            </label>
          ))}
        </div>
      )}
      {busy && <p className="gen">{busy}</p>}
      {prev && (
        <div className="su-prev">
          <div className="imp-stats">
            <div><b>{prev.rows}</b><span>ready ({prev.qty} on hand)</span></div>
            <div className={prev.rejected ? 'bad' : ''}><b>{prev.rejected}</b><span>can&apos;t be read</span></div>
            <div><b>{prev.gone}</b><span>sold / returned, left out</span></div>
          </div>
          {prev.block ? <p className="bad">{prev.block}</p> : (
            <>
              {prev.problems.length > 0 && (
                <details><summary>{prev.rejected} row{prev.rejected === 1 ? '' : 's'} won&apos;t load. Fix them in the sheet, or use <a href="/import">/import</a> to fix them with Claude.</summary>
                  <ul>{prev.problems.map(p => <li key={`${p.tab}-${p.row}`}><b>{prev.tabs.length > 1 ? `${p.tab} row` : 'Row'} {p.row}</b>: {p.msg} <span className="gen">({p.cells})</span></li>)}</ul>
                </details>
              )}
              <button className="primary" onClick={load} disabled={!!busy}>Load {prev.rows} {kind} into the counter</button>
            </>
          )}
        </div>
      )}
      {done && <p className="ok">{done}</p>}
      {err && <p className="bad">{err}</p>}
    </Step>
  );
}

export default function SetupWizard({ initial }: { initial: Status }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState('');
  const [seeding, setSeeding] = useState('');
  const seed = async () => {
    if (s.models && !window.confirm('Reload the make/model list from Wheel-Size? It uses about 120 lookups.')) return;
    setSeeding('Loading makes and models from Wheel-Size… (about a minute)');
    try {
      const r = await call<{ makes: number; models: number; hits: number }>('/api/setup/seed-models', {});
      setMsg(`Loaded ${r.models} models from ${r.makes} makes, using ${r.hits} Wheel-Size lookups.`);
      setS(await call<Status>('/api/setup/status'));
    } catch (e) { setMsg((e as Error).message); }
    setSeeding('');
  };
  const refresh = async () => { try { setS(await call<Status>('/api/setup/status')); setMsg(''); } catch (e) { setMsg((e as Error).message); } };
  const copySql = async () => {
    try {
      const sql = await (await fetch('/setup-all.sql')).text();
      await navigator.clipboard.writeText(sql);
      setMsg('Setup SQL copied. In Supabase: SQL Editor > New query > paste > Run. Then press Check again.');
    } catch { setMsg('Could not copy. Open the SQL file instead and copy it from there.'); }
  };
  const tablesOk = s.supabase && !s.missingTables.length;
  const ready = tablesOk && s.tires > 0;
  const chip = (on: boolean, yes: string, no: string) => <span className={`chip ${on ? 'ok' : 'warn'}`}>{on ? yes : no}</span>;

  return (
    <main className="imp su">
      <header className="imp-bar">
        <div className="brand"><a href="/"><img className="logo" src="/logo.png" alt="GreenCarTires.ca" width={480} height={71} /></a>Setup<span className="sub">first use</span></div>
        <nav><a href="/">Inventory</a> · <a href="/import">Import</a> · <a href="/sync">Sync</a></nav>
      </header>

      {s.demo && (
        <div className="banner pivot">Demo mode is on, so the counter shows sample stock and nothing below loads.
          To go live: connect Supabase, then set <code>DEMO_MODE</code> to <code>0</code> (or remove it) in Vercel and redeploy.</div>
      )}

      <div className="pane su-list">
        <Step n={1} done={s.supabase} title="Connect the database">
          {s.supabase ? <p>Supabase is connected.</p> : (
            <p>In Vercel &gt; Settings &gt; Environment Variables, add <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code>
              (Supabase &gt; Project Settings &gt; API), then redeploy.</p>
          )}
        </Step>

        <Step n={2} done={tablesOk} title="Create the tables">
          {tablesOk ? <p>All tables are there.</p> : (
            <>
              <p>{s.supabase ? `Missing: ${s.missingTables.join(', ')}.` : 'Once the database is connected:'} Copy the setup SQL, then in Supabase open
                SQL Editor &gt; New query, paste it and press Run. It is safe to run again.</p>
              <div className="soact"><button className="main" onClick={copySql}>Copy setup SQL</button>
                <a href="/setup-all.sql" target="_blank" rel="noopener">Open the SQL file</a>
                <button onClick={refresh}>Check again</button></div>
            </>
          )}
          {s.error && <p className="bad">{s.error}</p>}
        </Step>

        <LoadStep kind="tires" n={3} count={s.tires} enabled={tablesOk && !s.demo} onLoaded={refresh} />
        <LoadStep kind="wheels" n={4} count={s.wheels} enabled={tablesOk && !s.demo} onLoaded={refresh} />

        <Step n={5} done={s.googleSheet && s.wheelSize} title="Optional extras">
          <ul className="su-extras">
            <li>{chip(s.googleSheet, 'Set', 'Not set')} <b>Google Sheets sync</b>: keep stock in your sheet and sync it every 5 minutes. See <a href="/sync">/sync</a>.</li>
            <li>{chip(s.wheelSize, 'Set', 'Not set')} <b>Wheel-Size</b> (<code>WHEELSIZE_API_KEY</code>): vehicle fitment.{' '}
              {s.models ? `${s.models} makes and models in the list. ` : 'The make/model list is empty, so the vehicle boxes can\'t suggest names yet. '}
              {s.wheelSize && tablesOk && !s.demo && (
                <button className="su-inline" onClick={seed} disabled={!!seeding}>
                  {seeding || (s.models ? 'Reload the make/model list' : 'Load the make/model list (about 120 lookups, once)')}
                </button>
              )}</li>
            <li>{chip(s.anthropic, 'Set', 'Not set')} <b>Claude</b> (<code>ANTHROPIC_API_KEY</code>): fix messy rows on <a href="/import">/import</a>.</li>
            <li>{chip(s.password, 'Set', 'Not set')} <b>Admin password</b> (<code>ADMIN_PASSWORD</code>): needed for loading stock and using Claude once the site is public.</li>
          </ul>
        </Step>
      </div>

      <div className="su-foot">
        <p className="gen">Test files with made-up stock, including a few bad rows on purpose:{' '}
          <a href="/samples/demo-tires.csv" download>demo-tires.csv</a> · <a href="/samples/demo-wheels.csv" download>demo-wheels.csv</a></p>
        {ready ? <a className="primary su-go" href="/">Open the inventory →</a> : null}
        {msg && <p className="gen">{msg}</p>}
      </div>
    </main>
  );
}
