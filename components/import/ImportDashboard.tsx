'use client';
// /import — paste or upload a spreadsheet, get SQL for Supabase.
// 1. The rule-based cleaner (same one as the Sheets sync) reads every row in the browser, free and instant.
// 2. Rows it can't read, or the whole sheet if its columns aren't recognised, go to Claude (/api/import/claude).
// 3. Every row is checked against the database rules and toSql() writes the SQL. Claude never writes SQL itself.
import { useMemo, useState } from 'react';
import * as C from '@/lib/inventory-clean';

type Cleaned = C.Cleaned<C.TireRow | C.WheelRow>;
type Origin = 'rules' | 'claude';
type Line = Cleaned & { origin: Origin };
type Sheet = { name: string; rows: string[][] };
type Usage = { input: number; output: number; cacheRead: number; requests: number };

// Claude Opus 5.5 list prices, for an estimate only: $4 / $20 per million tokens, cache reads $0.20.
const cost = (u: Usage) => ((u.input * 4 + u.output * 20 + u.cacheRead * 0.2) / 1e6);

// SheetJS loads only when someone picks an Excel file.
let xlsxLib: Promise<any> | null = null;
const loadXlsx = () => (xlsxLib ??= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = () => resolve((window as any).XLSX); s.onerror = () => { xlsxLib = null; reject(new Error('Could not load the Excel reader. Check the connection, or save as CSV.')); };
  document.head.appendChild(s);
}));

function analyse(rows: string[][], kindOverride: C.Kind | null) {
  const nonEmpty = rows.filter(r => r.some(c => String(c ?? '').trim()));
  if (!nonEmpty.length) return null;
  const h = C.findHeaderRow(rows);
  const headers = (rows[h] ?? []).map(x => String(x ?? ''));
  const body = rows.slice(h + 1).map(r => r.map(x => String(x ?? '')));
  const kind = kindOverride ?? C.detectKind(headers, body);
  const map = C.autoMap(headers, kind);
  const missing = C.REQUIRED_FIELDS[kind].filter(g => !g.some(f => map[f] !== undefined)).map(g => C.FIELD_LABELS[g[0]]);
  const cleaned = C.cleanAll(kind, headers, body, map).map(c => ({ ...c, sourceRow: c.sourceRow + h }));
  return { headerIdx: h, headers, body, kind, map, missing, cleaned };
}

const summary = (kind: C.Kind, r: C.TireRow | C.WheelRow) => kind === 'tires'
  ? (({ tire_size, brand, model, condition, tread_32nds, load_index, speed_rating }) =>
      `${tire_size} ${[brand, model].filter(Boolean).join(' ')} · ${condition}${tread_32nds != null && condition === 'used' ? ` ${tread_32nds}/32` : ''}${load_index ? ` · ${load_index}${speed_rating ?? ''}` : ''}`)(r as C.TireRow)
  : (({ diameter, width, bolt_pattern, bolt_pattern_alt, wheel_offset, description, condition }) =>
      `${diameter}×${width ?? '?'} ET${wheel_offset ?? '?'} ${bolt_pattern}${bolt_pattern_alt ? '/' + bolt_pattern_alt : ''} · ${description ?? ''} · ${condition}`)(r as C.WheelRow);

export default function ImportDashboard({ claudeReady, needsPassword }: { claudeReady: boolean; needsPassword: boolean }) {
  const [text, setText] = useState('');
  const [book, setBook] = useState<Sheet[] | null>(null);
  const [tab, setTab] = useState(0);
  const [kindOverride, setKindOverride] = useState<C.Kind | null>(null);
  const [source, setSource] = useState('');
  const [sendAll, setSendAll] = useState(false);
  const [keepRaw, setKeepRaw] = useState(true);
  const [claude, setClaude] = useState<Map<number, Cleaned> | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [filter, setFilter] = useState<'all' | 'problems'>('problems');

  const rows = useMemo(() => (book ? book[tab]?.rows ?? [] : text.trim() ? C.parseDelimited(text) : []), [book, tab, text]);
  const a = useMemo(() => analyse(rows, kindOverride), [rows, kindOverride]);
  const reset = () => { setClaude(null); setUsage(null); setError(''); setCopied(''); };

  // Rule results, with Claude's answer swapped in for every row Claude handled.
  const lines: Line[] = useMemo(() => !a ? [] : a.cleaned.map(c => {
    const fixed = claude?.get(c.sourceRow);
    return fixed ? { ...fixed, origin: 'claude' as const } : { ...c, origin: 'rules' as const };
  }), [a, claude]);
  const good = lines.filter(l => l.row), bad = lines.filter(l => !l.row && !l.skipped), skipped = lines.filter(l => l.skipped);
  const fromClaude = good.filter(l => l.origin === 'claude').length;
  const toSend = !a ? [] : (sendAll || a.missing.length ? a.cleaned.filter(c => !c.skipped || c.issues.length || Object.keys(c.raw).length)
    : a.cleaned.filter(c => !c.row && !c.skipped)).filter(c => !claude?.has(c.sourceRow));
  const src = source.trim() || (a ? (book ? book[tab].name : a.kind === 'tires' ? 'Tires tab' : 'Wheels tab') : '');
  const sql = a && good.length ? C.toSql(a.kind, src, lines, { includeRaw: keepRaw }) : '';

  async function onFile(f: File) {
    reset(); setError(''); setKindOverride(null);
    try {
      if (/\.(xlsx|xls|ods)$/i.test(f.name)) {
        const XLSX = await loadXlsx();
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const sheets: Sheet[] = wb.SheetNames.map((n: string) => ({
          name: n, rows: (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }) as unknown[][]).map(r => r.map(c => String(c ?? ''))),
        })).filter((s: Sheet) => s.rows.some(r => r.some(c => c.trim())));
        setBook(sheets); setTab(0); setText('');
      } else {
        setBook(null); setText(await f.text());
      }
      if (!source) setSource(f.name.replace(/\.[^.]+$/, ''));
    } catch (e) { setError((e as Error).message); }
  }

  async function fixWithClaude() {
    if (!a || !toSend.length) return;
    setBusy(true); setError('');
    try {
      let pw = needsPassword ? sessionStorage.getItem('gct-admin') ?? '' : '';
      for (let attempt = 0; attempt < 2; attempt++) {
        if (needsPassword && !pw) { pw = window.prompt('Admin password') ?? ''; if (!pw) throw new Error('Password needed to use Claude.'); }
        const res = await fetch('/api/import/claude', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(pw ? { 'x-admin-password': pw } : {}) },
          body: JSON.stringify({ kind: a.kind, headers: a.headers, rows: toSend.map(c => ({ sourceRow: c.sourceRow, cells: a.body[c.sourceRow - a.headerIdx - 2] ?? [] })) }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) { sessionStorage.removeItem('gct-admin'); pw = ''; if (attempt === 0) continue; throw new Error('Wrong password.'); }
        if (!res.ok) throw new Error(body.error || `Claude import failed (${res.status})`);
        if (pw) sessionStorage.setItem('gct-admin', pw);
        const next = new Map(claude ?? []);
        for (const c of body.cleaned as Cleaned[]) next.set(c.sourceRow, c);
        setClaude(next);
        setUsage(u => u ? { input: u.input + body.usage.input, output: u.output + body.usage.output, cacheRead: u.cacheRead + body.usage.cacheRead, requests: u.requests + body.usage.requests } : body.usage);
        break;
      }
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  const copy = async () => { try { await navigator.clipboard.writeText(sql); setCopied('SQL copied. Paste it into Supabase > SQL Editor and press Run.'); } catch { setCopied('Select the SQL below and copy it.'); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([sql], { type: 'text/plain' }));
    const el = Object.assign(document.createElement('a'), { href: url, download: `${src.replace(/[^\w-]+/g, '-').toLowerCase() || 'inventory'}.sql` });
    el.click(); URL.revokeObjectURL(url);
  };
  const shown = filter === 'problems' ? lines.filter(l => !l.row || l.issues.length || l.origin === 'claude') : lines;

  return (
    <main className="imp">
      <header className="imp-bar">
        <div className="brand"><a href="/"><img className="logo" src="/logo.png" alt="GreenCarTires.ca" width={480} height={71} /></a>Inventory import<span className="sub">sheet → SQL</span></div>
        <nav><a href="/">Counter</a> · <a href="/sync">Sync</a></nav>
      </header>

      <section className="imp-grid">
        <div className="pane imp-in">
          <div className="eyebrow">1 · Your spreadsheet</div>
          <label className="imp-file">Upload CSV or Excel
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          </label>
          {book ? (
            <div className="imp-tabs">
              {book.map((s, i) => <button key={s.name} aria-pressed={i === tab} onClick={() => { setTab(i); reset(); setKindOverride(null); setSource(s.name); }}>{s.name}</button>)}
              <button onClick={() => { setBook(null); reset(); }}>Paste instead</button>
            </div>
          ) : (
            <textarea value={text} onChange={e => { setText(e.target.value); reset(); }} spellCheck={false}
              placeholder="Or copy the cells in Google Sheets or Excel (header row included) and paste here." />
          )}
          {a && (
            <div className="imp-opts">
              <div className="seg" role="group" aria-label="Tires or wheels">
                {(['tires', 'wheels'] as const).map(k => <button key={k} aria-pressed={a.kind === k} onClick={() => { setKindOverride(k); reset(); }}>{k === 'tires' ? 'Tires' : 'Wheels'}</button>)}
              </div>
              <label className="imp-src">Source name <input value={source} placeholder={src} onChange={e => setSource(e.target.value)} /></label>
            </div>
          )}
          {a && <p className="gen">Header on row {a.headerIdx + 1}. Columns found: {Object.keys(a.map).map(f => C.FIELD_LABELS[f]).join(', ') || 'none'}.
            {a.missing.length ? <b className="bad"> Not found: {a.missing.join(', ')}. Claude will read the whole sheet.</b> : null}</p>}
        </div>

        <div className="pane imp-mid">
          <div className="eyebrow">2 · Read and fix</div>
          {!a ? <p className="gen">Paste or upload a sheet to start.</p> : (
            <>
              <div className="imp-stats">
                <div><b>{good.length}</b><span>ready{fromClaude ? ` (${fromClaude} fixed by Claude)` : ''}</span></div>
                <div className={bad.length ? 'bad' : ''}><b>{bad.length}</b><span>can&apos;t be read</span></div>
                <div><b>{skipped.length}</b><span>skipped (titles, blanks)</span></div>
              </div>
              {claudeReady ? (
                <>
                  <button className="primary" disabled={busy || !toSend.length} onClick={fixWithClaude}>
                    {busy ? 'Claude is reading…' : toSend.length ? `Fix ${toSend.length} row${toSend.length === 1 ? '' : 's'} with Claude` : 'Nothing left for Claude'}
                  </button>
                  {!a.missing.length && <label className="check"><input type="checkbox" checked={sendAll} onChange={e => setSendAll(e.target.checked)} /> Send every row to Claude, not just the problems</label>}
                </>
              ) : <p className="gen">To fix problem rows with Claude, add <code>ANTHROPIC_API_KEY</code> in Vercel and redeploy. The rows the rules can read still turn into SQL below.</p>}
              {usage && <p className="gen">Claude: {usage.requests} request{usage.requests === 1 ? '' : 's'}, {(usage.input + usage.cacheRead).toLocaleString()} tokens in, {usage.output.toLocaleString()} out, about ${cost(usage).toFixed(2)}.</p>}
              {error && <div className="warns"><div className="bad">{error}</div></div>}
            </>
          )}
        </div>

        <div className="pane imp-out">
          <div className="eyebrow">3 · SQL for Supabase</div>
          {sql ? (
            <>
              <div className="soact"><button className="main" onClick={copy}>Copy SQL</button><button onClick={download}>Download .sql</button></div>
              <label className="check"><input type="checkbox" checked={keepRaw} onChange={e => setKeepRaw(e.target.checked)} /> Keep each original row (raw column)</label>
              <p className="gen">{copied || `Replaces every row previously imported as "${src}". Rows that can't be read are left out.`}</p>
              <textarea readOnly value={sql} className="mono" />
            </>
          ) : <p className="gen">The SQL appears here once at least one row is ready.</p>}
        </div>
      </section>

      {a && (
        <section className="pane imp-rows">
          <div className="imp-rowhead">
            <div className="eyebrow">Rows</div>
            <div className="seg">
              <button aria-pressed={filter === 'problems'} onClick={() => setFilter('problems')}>Problems + Claude fixes</button>
              <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All {lines.length}</button>
            </div>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th className="r">Row</th><th>Status</th><th>Reads as</th><th>Notes</th><th>Original</th></tr></thead>
              <tbody>
                {shown.length ? shown.map(l => (
                  <tr key={l.sourceRow} className={!l.row && !l.skipped ? 'imp-bad' : ''}>
                    <td className="r mono">{l.sourceRow}</td>
                    <td>{l.skipped ? <span className="chip">Skipped</span> : !l.row ? <span className="chip warn">Not read</span>
                      : l.origin === 'claude' ? <span className="chip w">Claude</span> : <span className="chip ok">Rules</span>}</td>
                    <td className="mono">{l.row ? `${summary(a.kind, l.row)} · qty ${(l.row as { qty: number }).qty}${(l.row as { price: number | null }).price != null ? ` · $${(l.row as { price: number }).price}` : ''}` : '—'}</td>
                    <td className="imp-notes">{l.issues.map(i => i.msg).join(' · ')}</td>
                    <td className="imp-raw">{Object.values(l.raw).join(' · ')}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="empty">No problems. Every row reads cleanly.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
