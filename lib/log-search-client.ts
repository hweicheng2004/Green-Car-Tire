// Client-side: records a search once the tech stops typing, not on every keystroke.
// Usage in the dashboard, after results render:
//   logSearch({ kind: 'vehicle', query, year, makeSlug, modelSlug, tireSize, oeSizes, exactInStock, newInStock, altInStock, wheelsInStock, fitmentSource })
//   ...and call flushSearch() on Enter, row click, or "Copy quote" so the search is saved immediately.
import type { CounterSearch } from './search-log';

const SETTLE_MS = 1500;
let pending: CounterSearch | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = '';

const station = () => { try { return localStorage.getItem('gct-station'); } catch { return null; } };

function send(s: CounterSearch) {
  // Same vehicle/size and same stock picture as the last one sent = the same search, skip it.
  const sig = [s.kind, s.year, s.makeSlug, s.modelSlug, s.tireSize, s.exactInStock, s.altInStock].join('|');
  if (sig === lastSent) return;
  lastSent = sig;
  const body = JSON.stringify({ ...s, station: s.station ?? station() });
  // keepalive lets the request finish even if the page is closing
  fetch('/api/searches', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true })
    .catch(() => { /* logging must never interrupt a quote */ });
}

export function logSearch(s: CounterSearch, settleMs = SETTLE_MS) {
  pending = s;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSearch, settleMs);
}

export function flushSearch() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (pending) { const s = pending; pending = null; send(s); }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSearch);

/** test hook */
export const _reset = () => { pending = null; lastSent = ''; if (timer) clearTimeout(timer); timer = null; };
