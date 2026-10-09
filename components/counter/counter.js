// Counter screen logic, ported from the clickable prototype. Plain DOM code: React renders the markup once
// (components/counter/markup.ts) and this fills the panes. Data comes from the server (lib/counter-data.ts shapes):
//   data      CounterInventory: tires, wheels, fees, status line, "Try:" examples
//   api       { vehicle(q) -> VehicleResult, oeOn(size) -> [{label, q}] }
//   log/flush search logging (lib/log-search-client.ts); no-ops in demo mode
// Returns a cleanup function that removes every listener (React runs effects twice in development).

import { exampleToTemplate, fillTemplate, hasSlots, isHttpUrl } from './order-link';

const SIZE_RE = /^\s*(?:P|LT)?\s*(\d{3})\s*[\/\s\-]*\s*(\d{2})\s*[\sRZ\/\-]*\s*(\d{2})\s*$/i;
export function parseSize(s) {
  const m = String(s).match(SIZE_RE); if (!m) return null;
  const w = +m[1], a = +m[2], r = +m[3]; if (w < 125 || w > 355 || a < 25 || a > 85 || r < 12 || r > 24) return null;
  return { w, a, r, key: `${w}/${a}R${r}` };
}
const dia = s => 2 * s.w * s.a / 100 / 25.4 + s.r; // inches
const SR = ['L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y'];
const srRank = s => SR.indexOf(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => (n == null ? '—' : n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' }));
const SEASON = { W: 'Winter', AW: 'All-weather', AS: 'All-season', S: 'Summer' };
const GRADE = { A: 'Grade A · clean', B: 'Grade B · light wear', C: 'Grade C · cosmetic damage' };
const SEAT = { conical: 'conical (60°)', ball: 'ball (radius)', flat: 'flat (mag)' };
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
const q2 = v => (v == null ? '?' : v);

/** @param {{ data: any, api: { vehicle: (q: string) => Promise<any>, oeOn: (size: string) => Promise<any[]> }, log?: (s: any) => void, flush?: () => void }} opts */
export function startCounter({ data, api, log = () => {}, flush = () => {} }) {
  const ac = new AbortController();
  const on = (t, ev, fn) => t.addEventListener(ev, fn, { signal: ac.signal });
  const $ = id => document.getElementById(id);

  const INV = data.tires.map(t => ({ ...t, s: parseSize(t.size) })).filter(t => t.s);
  const WHL = data.wheels;
  // Indexes built once: a search only scans tires on the same rim size, and OE badges read a precomputed count.
  const byRim = new Map(), qtyBySize = new Map(), maxLiBySize = new Map();
  for (const t of INV) {
    (byRim.get(t.s.r) || byRim.set(t.s.r, []).get(t.s.r)).push(t);
    qtyBySize.set(t.size, (qtyBySize.get(t.size) || 0) + t.qty);
    maxLiBySize.set(t.size, Math.max(maxLiBySize.get(t.size) ?? 0, t.li ?? 0));
  }
  const SIZES = [...qtyBySize.keys()];
  const onHand = key => qtyBySize.get(key) || 0;
  const wsize = w => `${w.d}×${q2(w.w)}`;
  const VEHCACHE = new Map(), OECACHE = new Map();

  // Fees: shop settings from the server; edits on this PC are kept in this browser.
  let fees = { ...data.fees, dist: [...data.fees.dist] };
  try { const s = JSON.parse(localStorage.getItem('gct-fees') || 'null'); if (s) fees = { ...fees, ...s }; } catch (e) {}
  if (!fees.tc) fees.tc = data.fees.tc || '';   // a blank on this PC never hides the shop-wide TireConnect address

  const st = { mode: 'none', veh: null, oeIdx: 0, target: null, oe: null, rows: [], excluded: [], sel: null, qty: 4, season: 'all', cond: 'all', stock: true,
    tab: 'tires', wrows: [], wex: [], wsel: null, wtype: 'all', wcond: 'all', sensors: false, query: '' };
  let vseq = 0, vtimer = null;

  // ---------- Fitment math ----------
  function compute() { computeTires(); computeWheels(); }
  function computeTires() {
    const tgt = st.target, oe = st.oe; st.rows = []; st.excluded = [];
    if (!tgt) return;
    const d0 = dia(tgt), ex = new Map();
    for (const t of byRim.get(tgt.r) || []) {
      let group = null, delta = 0;
      if (t.size === tgt.key) group = 'exact';
      else if (Math.abs(t.s.w - tgt.w) <= 10) {
        delta = (dia(t.s) - d0) / d0 * 100;
        if (Math.abs(delta) <= fees.tol) group = 'alt';
      }
      if (!group) continue;
      // Below the OE load index (or unknown): never offered for this vehicle.
      if (oe && oe.li != null && (t.li ?? 0) < oe.li) {
        const e = ex.get(t.size) || { size: t.size, li: t.li, n: 0 }; e.n += t.qty; e.li = Math.max(e.li ?? 0, t.li ?? 0); ex.set(t.size, e); continue;
      }
      st.rows.push({ ...t, group, delta, srWarn: !!(oe && oe.sr && t.sr && t.season !== 'W' && srRank(t.sr) < srRank(oe.sr)) });
    }
    st.excluded = [...ex.values()];
    st.rows.sort((a, b) => (a.group === b.group ? 0 : a.group === 'exact' ? -1 : 1) || Math.abs(a.delta) - Math.abs(b.delta)
      || (b.qty > 0) - (a.qty > 0) || (a.price ?? 1e9) - (b.price ?? 1e9));
  }
  function suggestTire(d, ref) {
    const d0 = dia(parseSize(ref.size)); let best = null;
    for (const k of SIZES) {
      const s = parseSize(k); if (s.r !== d) continue;
      const delta = (dia(s) - d0) / d0 * 100;
      const li = maxLiBySize.get(k);
      if (Math.abs(delta) <= fees.tol && li >= (ref.li ?? 0) && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { key: k, delta };
    }
    return best;
  }
  // Wheel rules: PCD must match exactly. Bore must be >= hub (larger needs a hub-centric ring).
  // Diameter within 1" of an OE size. Width within 1" and offset within 15 mm of the closest OE wheel.
  // A blank width, offset or bore in the sheet never rules a wheel out; it lands in "fits with notes" to check by hand.
  function computeWheels() {
    st.wrows = []; st.wex = [];
    if (st.mode !== 'vehicle') return;
    const v = st.veh.v;
    if (!v.bolt) return;
    const rims = v.oe.map(o => ({ size: o[0], li: o[1], d: parseSize(o[0]).r, w: o[4], et: o[5] }));
    const ds = rims.map(r => r.d), minD = Math.min(...ds), maxD = Math.max(...ds), cur = rims[st.oeIdx];
    for (const w of WHL) {
      if (!w.pcds.includes(v.bolt) || w.d < minD - 1 || w.d > maxD + 1) continue;
      if (v.cb != null && w.cb != null && w.cb < v.cb - 0.05) { st.wex.push({ w, why: `bore ${w.cb} mm is smaller than the ${v.cb} mm hub` }); continue; }
      const same = rims.filter(r => r.d === w.d);
      const ref = same.length ? same.reduce((a, b) => Math.abs((b.et ?? 0) - (w.et ?? 0)) < Math.abs((a.et ?? 0) - (w.et ?? 0)) ? b : a)
        : rims.reduce((a, b) => Math.abs(b.d - w.d) < Math.abs(a.d - w.d) ? b : a);
      const dW = w.w != null && ref.w != null ? +(w.w - ref.w).toFixed(1) : 0, dEt = w.et != null && ref.et != null ? w.et - ref.et : 0;
      if (Math.abs(dW) > 1) { st.wex.push({ w, why: `${sgn(dW)}″ wider than OE ${ref.d}×${ref.w}` }); continue; }
      if (Math.abs(dEt) > Math.max(15, fees.et)) { st.wex.push({ w, why: `offset ${w.et} vs OE ${ref.et}` }); continue; }
      const unknown = [w.w == null && 'width', w.et == null && 'offset', w.cb == null && 'bore'].filter(Boolean);
      const ring = v.cb != null && w.cb != null && w.cb > v.cb + 0.05, minus = w.d < minD, plus = w.d > maxD, etWarn = Math.abs(dEt) > fees.et;   // within the shop's offset range = a normal fit
      const lug = !!(w.seat && v.seat && w.seat !== v.seat);
      const tire = same.length ? { key: ref.size, delta: 0 } : suggestTire(w.d, ref);
      // A bigger bore is a normal fit: hub-centric rings take up the gap and go on the quote automatically.
      // Only a smaller bore rules a wheel out (above). Size, offset and width changes still get their own group.
      const direct = !minus && !plus && !etWarn && Math.abs(dW) <= 0.5 && !unknown.length;
      st.wrows.push({ ...w, ref, dW, dEt, ring, minus, plus, etWarn, lug, unknown, tire, group: direct ? 'direct' : 'adapt', cur: w.d === cur.d });
    }
    st.wrows.sort((a, b) => (a.group === b.group ? 0 : a.group === 'direct' ? -1 : 1) || (b.cur - a.cur) || (b.qty > 0) - (a.qty > 0) || (a.ring - b.ring) || (a.price ?? 1e9) - (b.price ?? 1e9));
  }
  function visible() {
    return st.rows.filter(r => (!st.stock || r.qty > 0) && (st.season === 'all' || r.season === st.season) && (st.cond === 'all' || (st.cond === 'new' ? !r.used : r.used)));
  }
  function visibleW() {
    return st.wrows.filter(w => (!st.stock || w.qty > 0) && (st.wtype === 'all' || w.type === st.wtype) && (st.wcond === 'all' || (st.wcond === 'new' ? !w.used : w.used)));
  }
  function autoSelect() {
    const v = visible();
    const pick = v.find(r => r.group === 'exact' && r.qty > 0) || v.find(r => r.qty > 0) || v[0];
    st.sel = pick ? pick.id : null;
    const w = visibleW();
    const wp = w.find(r => r.group === 'direct' && r.cur && r.qty > 0) || w.find(r => r.qty > 0) || w[0];
    st.wsel = wp ? wp.id : null;
  }

  // ---------- Search log (live mode) ----------
  function logCurrent() {
    const q = st.query; if (!q || q.length < 3) return;
    const exact = st.rows.filter(r => r.group === 'exact'), alt = st.rows.filter(r => r.group === 'alt');
    const sum = a => a.reduce((n, r) => n + r.qty, 0);
    const v = st.mode === 'vehicle' ? st.veh.v : null;
    log({
      kind: st.lastKind, query: q,
      year: v ? v.year : st.veh && st.veh.year || null, makeSlug: v && v.makeSlug, modelSlug: v && v.modelSlug,
      tireSize: st.target ? st.target.key : null, oeSizes: v ? v.oe.map(o => o[0]) : [],
      exactInStock: sum(exact), newInStock: sum(exact.filter(r => !r.used)), altInStock: sum(alt),
      wheelsInStock: v ? st.wrows.filter(w => w.qty > 0).length : null,
      fitmentSource: v ? (v.source === 'demo' ? 'none' : v.source) : (st.lastKind === 'vehicle' ? 'none' : undefined),
    });
  }

  // ---------- Search ----------
  let lastBox = 'qv';
  function setActive(id) {
    lastBox = id;
    $('qv').closest('.field').classList.toggle('active', id === 'qv');
    $('qs').closest('.field').classList.toggle('active', id === 'qs');
  }
  function clearBox(id) { $(id).value = ''; const p = $(id === 'qv' ? 'parseV' : 'parseS'); p.className = 'parse none'; p.textContent = '—'; }
  function showNone(label) {
    Object.assign(st, { mode: 'none', veh: null, target: null, oe: null });
    const p = $('parseV'); p.className = 'parse none'; p.textContent = label;
    compute(); autoSelect(); render();
  }
  function searchVehicle(q) {
    setActive('qv'); clearBox('qs');
    q = q.trim(); const seq = ++vseq; clearTimeout(vtimer);
    st.query = q; st.lastKind = 'vehicle';
    if (!q) return showNone('—');
    if (parseSize(q)) return showNone('That’s a size →');
    const key = q.toLowerCase().replace(/\s+/g, ' ');
    if (VEHCACHE.has(key)) return applyVehicle(VEHCACHE.get(key));
    const p = $('parseV'); p.className = 'parse none'; p.textContent = '…';
    vtimer = setTimeout(() => {
      api.vehicle(q).then(r => {
        if (!r.error) VEHCACHE.set(key, r);
        if (seq === vseq) applyVehicle(r);
      }).catch(() => { if (seq === vseq) showNone('Lookup failed'); });
    }, 250);
  }
  function applyVehicle(r) {
    const p = $('parseV');
    if (r.vehicle && r.vehicle.oe.length) {
      const v = r.vehicle;
      Object.assign(st, { mode: 'vehicle', veh: { v, year: v.year, assumed: v.assumed }, oeIdx: 0 }); setOE(0, false);
      p.className = 'parse veh'; p.textContent = `${v.year} ${v.make} ${v.model}`;
    } else if (r.vehicle || r.miss) {
      const m = r.miss || { year: r.vehicle.year, label: `${r.vehicle.make} ${r.vehicle.model}`, why: 'No tire sizes on file for this vehicle. Check the door placard.' };
      Object.assign(st, { mode: 'miss', veh: m, target: null, oe: null });
      p.className = 'parse none'; p.textContent = 'No fitment';
    } else {
      Object.assign(st, { mode: 'none', veh: null, target: null, oe: null });
      p.className = 'parse none'; p.textContent = r.error ? 'Lookup failed' : 'No match';
    }
    compute(); autoSelect(); render(); logCurrent();
  }
  function searchSize(q) {
    setActive('qs'); clearBox('qv'); ++vseq; clearTimeout(vtimer);
    const p = $('parseS'); q = q.trim();
    st.query = q; st.lastKind = 'size';
    const size = q ? parseSize(q) : null;
    if (size) {
      Object.assign(st, { mode: 'size', veh: null, target: size, oe: null, tab: 'tires' });
      p.className = 'parse size'; p.textContent = size.key;
    } else {
      Object.assign(st, { mode: 'none', veh: null, target: null, oe: null });
      p.className = 'parse none'; p.textContent = !q ? '—' : (q.replace(/\D/g, '').length < 7 ? 'Keep typing' : 'Not a size');
    }
    compute(); autoSelect(); render();
    if (size) logCurrent();
  }
  function setOE(i, rerender = true) {
    const o = st.veh.v.oe; st.oeIdx = (i + o.length) % o.length;
    const [key, li, sr] = o[st.oeIdx]; st.target = parseSize(key); st.oe = { li, sr };
    if (rerender) { compute(); autoSelect(); render(); logCurrent(); }
  }
  function setTab(t) { if (t === st.tab) return; st.tab = t; renderStock(); renderQuote(); }

  // ---------- Render ----------
  function render() { renderFit(); renderStock(); renderQuote(); }

  function renderFit() {
    const el = $('fit');
    if (st.mode === 'vehicle') {
      const { v, year, assumed } = st.veh;
      const li = st.oe.li;
      const src = v.source === 'demo' ? 'Sample fitment (demo)' : v.source === 'stale' ? 'Wheel-Size, older cached copy (lookup failed just now)' : 'Wheel-Size';
      el.innerHTML = `<div><div class="eyebrow">Vehicle</div><h2>${year} ${esc(v.make)} ${esc(v.model)}</h2>
        <div class="gen">${v.gen ? esc(v.gen) + ' generation' : ''}${assumed ? ' · no year typed, assuming latest' : ''}</div></div>
        <div><div class="eyebrow">OE sizes · pick by trim</div><div class="oe">${v.oe.map((o, i) => { const n = onHand(o[0]); return `
          <button data-oe="${i}" aria-pressed="${i === st.oeIdx}"><span class="sz">${o[0]} <span style="color:var(--muted);font-weight:500">${q2(o[1])}${o[2] ?? ''}</span></span>
          <span class="trim">${esc(o[3])} · <span class="mono">${parseSize(o[0]).r}×${q2(o[4])} ET${q2(o[5])}</span></span><span class="cnt ${n ? 'in' : 'out'}">${n ? n + ' tires' : 'no tires'}</span></button>`; }).join('')}</div></div>
        <div><div class="eyebrow">Wheel fitment</div><dl><dt>Bolt pattern (PCD)</dt><dd>${esc(v.bolt ?? '—')}</dd><dt>Center bore</dt><dd>${v.cb != null ? v.cb + ' mm' : '—'}</dd>
          <dt>Lug thread</dt><dd>${esc(v.lug ?? '—')}</dd><dt>OE lug seat</dt><dd>${v.seat ? SEAT[v.seat].split(' ')[0] : '—'}</dd><dt>Torque</dt><dd>${v.tq ? v.tq + ' ft·lb' : '—'}</dd></dl></div>
        ${v.mixed && v.mixed.length ? `<div class="warns">${v.mixed.map(m => `<div class="pivot">${esc(m)}</div>`).join('')}</div>` : ''}
        <div class="note">Confirm trim on the driver's door placard. ${li != null ? `Alternate tires must meet OE load index ${li}.` : 'OE load index not on file; match the placard.'} <br>${src}.</div>`;
    } else if (st.mode === 'size') {
      const s = st.target, d = dia(s), mm = d * 25.4;
      const fits = OECACHE.get(s.key);
      if (!fits) {
        OECACHE.set(s.key, null);
        api.oeOn(s.key).then(list => { OECACHE.set(s.key, list); if (st.mode === 'size' && st.target.key === s.key) renderFit(); })
          .catch(() => { OECACHE.set(s.key, []); });
      }
      el.innerHTML = `<div><div class="eyebrow">Tire size</div><h2 class="mono" style="font-family:var(--mono);font-size:26px">${s.key}</h2>
        <div class="gen">Direct size lookup</div></div>
        <div><div class="eyebrow">Geometry</div><dl><dt>Overall diameter</dt><dd>${d.toFixed(1)}″ · ${mm.toFixed(0)} mm</dd>
        <dt>Section width</dt><dd>${s.w} mm · ${(s.w / 25.4).toFixed(1)}″</dd><dt>Sidewall</dt><dd>${(s.w * s.a / 100).toFixed(0)} mm</dd>
        <dt>Revs / km</dt><dd>${(1e6 / (Math.PI * mm)).toFixed(0)}</dd><dt>Rim</dt><dd>${s.r}″</dd></dl></div>
        <div><div class="eyebrow">OE on</div>${!fits ? '<div class="gen">Looking up…</div>' : fits.length
          ? `<div class="fitlist">${fits.map(f => `<button data-v="${esc(f.q)}">${esc(f.label)}</button>`).join('')}</div>`
          : `<div class="gen">${data.mode === 'demo' ? 'No sample vehicles use this size.' : 'No vehicle looked up so far came on this size. The list grows as the counter is used.'}</div>`}</div>
        <div class="note">No vehicle selected, so load index isn't checked. Match it to the customer's door placard. Wheels need a vehicle search.</div>`;
    } else if (st.mode === 'miss') {
      el.innerHTML = `<div><div class="eyebrow">Vehicle</div><h2>${st.veh.year ?? ''} ${esc(st.veh.label)}</h2></div><div class="gen">${esc(st.veh.why || 'No fitment on file for this year.')} Check the door placard and search the size directly.</div>`;
    } else {
      el.innerHTML = `<div><div class="eyebrow">Fitment</div><div class="gen">Type a year and model, like <span class="mono">21 rav4</span>, or a size off the sidewall, like <span class="mono">225 65 17</span>.</div></div>`;
    }
  }

  function renderTabs() {
    const tn = st.target ? visible().length : 0, wn = st.mode === 'vehicle' ? visibleW().length : null;
    $('tabs').innerHTML = `<button role="tab" data-tab="tires" aria-selected="${st.tab === 'tires'}">Tires <span class="n">${tn}</span><kbd>T</kbd></button>
      <button role="tab" data-tab="wheels" aria-selected="${st.tab === 'wheels'}">Wheels <span class="n">${wn === null ? '—' : wn}</span><kbd>W</kbd></button>`;
    $('ttable').hidden = st.tab !== 'tires'; $('wtable').hidden = st.tab !== 'wheels';
  }
  function renderStock() { renderTabs(); if (st.tab === 'tires') { renderTires(); renderSpecial(); } else { renderWheels(); $('special').innerHTML = ''; } }
  function distLinks(s) {
    return (fees.dist || []).filter(d => d && isHttpUrl(d.url)).map((d, i) => {
      const href = fillTemplate(exampleToTemplate(d.url), s);
      return `<a href="${esc(href)}" target="_blank" rel="noopener" data-order="${s.key}" data-filled="${hasSlots(exampleToTemplate(d.url))}">${esc(d.name || 'Distributor ' + (i + 1))} ↗</a>`;
    });
  }
  const tcOn = () => isHttpUrl(fees.tc);
  const tcHref = s => fillTemplate(exampleToTemplate(fees.tc), s);
  const tcLink = s => tcOn() ? `<a class="main" id="orderTc" href="${esc(tcHref(s))}" target="_blank" rel="noopener" data-order="${s.key}" data-filled="${hasSlots(exampleToTemplate(fees.tc))}">Order on TireConnect ↗ <kbd>O</kbd></a>` : '';
  // Opening a portal also copies the size, so a portal that can't take it in the address is one paste away.
  function copyForOrder(size, filled) {
    const o = $('sizeCopied'); if (!o) return;
    const done = () => { o.hidden = false; o.textContent = filled ? `Opened with ${size}. Size also copied.` : `${size} copied. Paste it into the search box.`; };
    try { navigator.clipboard.writeText(size).then(done).catch(() => { o.hidden = false; o.textContent = `Search for ${size}.`; }); } catch (e) { o.hidden = false; o.textContent = `Search for ${size}.`; }
    flush();
  }
  function renderSpecial() {
    const el = $('special'), s = st.target;
    if (!s) { el.innerHTML = ''; return; }
    const newIn = st.rows.some(r => r.group === 'exact' && !r.used && r.qty > 0);
    if (newIn) { el.innerHTML = ''; return; }
    const links = distLinks(s);
    const usedIn = st.rows.some(r => r.qty > 0);
    el.innerHTML = `<div class="so" role="status">
      <div><div class="eyebrow" style="color:var(--accent);margin:0">No new tire in stock · special order</div>
        <div class="sosize">${s.key}</div>
        <div class="gen">${st.oe && st.oe.li != null ? `Order load ${st.oe.li}${st.oe.sr ?? ''} or higher. ` : ''}${usedIn ? 'Used or alternate stock is listed below if the customer can\'t wait.' : 'Nothing on the shelf to pivot to.'}</div></div>
      <div class="soact">${tcLink(s)}${links.join('')}
        ${tcOn() ? '' : `<a href="https://www.google.com/search?q=${encodeURIComponent(s.key + ' tire')}" target="_blank" rel="noopener">Search web ↗</a>`}
        <button id="copySize" data-size="${s.key}">Copy size</button></div>
      ${tcOn() ? '' : '<div class="feehint" style="margin:0">Add your TireConnect address under Shop fees &amp; rules to order in one click.</div>'}
      <div class="gen" id="sizeCopied" style="width:100%;margin:0" hidden></div>
    </div>`;
  }

  function renderTires() {
    const rows = $('rows'), ban = $('banner'), fil = $('filters'), ex = $('excl');
    if (!st.target) { ban.innerHTML = ''; fil.innerHTML = ''; ex.innerHTML = ''; rows.innerHTML = `<tr><td colspan="9" class="empty">Search a vehicle or size to see what's on the shelf.</td></tr>`; return; }
    const key = st.target.key;
    const exactIn = st.rows.filter(r => r.group === 'exact' && r.qty > 0), altIn = st.rows.filter(r => r.group === 'alt' && r.qty > 0);
    const sumQ = a => a.reduce((n, r) => n + r.qty, 0);
    if (exactIn.length) ban.innerHTML = `<div class="banner ok"><b>${key}</b> ${sumQ(exactIn)} on hand across ${exactIn.length} line${exactIn.length > 1 ? 's' : ''}${altIn.length ? ` · ${altIn.length} safe alternate line${altIn.length > 1 ? 's' : ''} too` : ''}</div>`;
    else if (altIn.length) ban.innerHTML = `<div class="banner pivot"><b>${key}</b> is out of stock. ${sumQ(altIn)} tires in ${altIn.length} safe alternate line${altIn.length > 1 ? 's' : ''} within ±${fees.tol}% diameter.</div>`;
    else ban.innerHTML = `<div class="banner info"><b>${key}</b> Nothing on hand in this size or a safe alternate. Quote a special order.</div>`;

    const base = st.rows.filter(r => (!st.stock || r.qty > 0));
    const cnt = s => base.filter(r => s === 'all' || r.season === s).length;
    const segS = [['all', 'All'], ['W', 'Winter'], ['AW', 'All-weather'], ['AS', 'All-season']].map(([k, l]) => `<button data-season="${k}" aria-pressed="${st.season === k}">${l}<span class="n">${cnt(k)}</span></button>`).join('');
    const segC = [['all', 'New + used'], ['new', 'New'], ['used', 'Used']].map(([k, l]) => `<button data-cond="${k}" aria-pressed="${st.cond === k}">${l}</button>`).join('');
    fil.innerHTML = `<div class="seg" role="group" aria-label="Season">${segS}</div><div class="seg" role="group" aria-label="Condition">${segC}</div>
      <label class="check"><input type="checkbox" id="instock" ${st.stock ? 'checked' : ''}> In stock only</label>`;

    const v = visible();
    if (!v.length) { rows.innerHTML = `<tr><td colspan="9" class="empty">No tires match these filters.</td></tr>`; }
    else {
      let html = '', last = null;
      for (const r of v) {
        if (r.group !== last) {
          last = r.group;
          html += r.group === 'exact' ? `<tr class="grp"><td colspan="9">${st.mode === 'vehicle' ? 'OE size' : 'Exact size'}<span>${key}</span></td></tr>`
            : `<tr class="grp"><td colspan="9">Safe alternates<span>±${fees.tol}% diameter · same ${st.target.r}″ wheel${st.oe && st.oe.li != null ? ` · load ≥ ${st.oe.li}` : ''}</span></td></tr>`;
        }
        const dc = Math.abs(r.delta) < 1 ? 'd0' : Math.abs(r.delta) < 2 ? 'd1' : 'd2';
        const delta = r.group === 'alt' ? `<span class="chip ${dc}">${r.delta > 0 ? '+' : '−'}${Math.abs(r.delta).toFixed(1)}%</span>` : '';
        const sea = r.season === 'W' ? '<span class="chip w">Winter</span>' : r.season === 'AW' ? '<span class="chip aw">All-wthr</span>'
          : r.season === 'S' ? '<span class="chip">Summer</span>' : r.season === 'AS' ? '<span class="chip">All-szn</span>' : '<span class="chip">?</span>';
        html += `<tr class="row${r.id === st.sel ? ' sel' : ''}${r.qty === 0 ? ' zero' : ''}" data-id="${r.id}">
          <td class="mono">${r.size}${delta}</td>
          <td class="tname"><b>${esc(r.brand)}</b> <span>${esc(r.model)}</span></td>
          <td>${sea}</td>
          <td>${r.used ? `Used${r.tread != null ? ` <span class="mono">${r.tread}/32″</span>` : ''}` : 'New'}</td>
          <td class="mono">${q2(r.li)}${r.sr ?? ''}${r.xl ? '<span class="chip xl">XL</span>' : ''}${r.srWarn ? '<span class="chip warn" title="Speed rating below OE">SR&lt;OE</span>' : ''}</td>
          <td class="mono">${r.dot ?? '—'}</td>
          <td class="r mono ${r.qty ? '' : 'qty0'}">${r.qty}</td>
          <td class="r price">${money(r.price)}</td>
          <td><span class="loc">${esc(r.loc || '—')}</span></td></tr>`;
      }
      rows.innerHTML = html;
    }
    ex.innerHTML = st.excluded.length ? `<div class="excl">Hidden for this vehicle: ${st.excluded.map(e => `<b>${e.size}</b> (load ${e.li || 'unknown'} &lt; OE ${st.oe.li}, ${e.n} on hand)`).join(', ')}</div>` : '';
  }

  function renderWheels() {
    const rows = $('wrows'), ban = $('banner'), fil = $('filters'), ex = $('excl');
    if (st.mode !== 'vehicle') {
      ban.innerHTML = `<div class="banner info">Wheels are matched by bolt pattern and center bore. Search a year, make and model.</div>`;
      fil.innerHTML = ''; ex.innerHTML = ''; rows.innerHTML = `<tr><td colspan="9" class="empty">Type a vehicle in the year · make · model box.</td></tr>`; return;
    }
    const v = st.veh.v, inS = st.wrows.filter(w => w.qty > 0);
    const dn = inS.filter(w => w.group === 'direct').length, an = inS.length - dn, rn = inS.filter(w => w.group === 'direct' && w.ring).length;
    const spec = `${esc(v.bolt ?? 'bolt pattern unknown')}${v.cb != null ? ` · ${v.cb} mm bore` : ''}`;
    ban.innerHTML = !v.bolt ? `<div class="banner info">No bolt pattern on file for this vehicle, so wheels can't be matched.</div>`
      : inS.length ? `<div class="banner ${dn ? 'ok' : 'pivot'}"><b>${spec}</b> ${dn} line${dn === 1 ? '' : 's'} fit${dn === 1 ? 's' : ''}${rn ? ` (${rn} with hub rings, added to the quote)` : ''}${an ? `, ${an} more with a size or offset change` : ''}</div>`
      : `<div class="banner info"><b>${spec}</b> No wheels on hand for this vehicle.</div>`;
    const segT = [['all', 'All'], ['Alloy', 'Alloy'], ['Steel', 'Steel']].map(([k, l]) => `<button data-wtype="${k}" aria-pressed="${st.wtype === k}">${l}<span class="n">${st.wrows.filter(w => (!st.stock || w.qty > 0) && (k === 'all' || w.type === k)).length}</span></button>`).join('');
    const segC = [['all', 'New + used'], ['new', 'New'], ['used', 'Used']].map(([k, l]) => `<button data-wcond="${k}" aria-pressed="${st.wcond === k}">${l}</button>`).join('');
    fil.innerHTML = `<div class="seg" role="group" aria-label="Wheel type">${segT}</div><div class="seg" role="group" aria-label="Condition">${segC}</div>
      <label class="check"><input type="checkbox" id="instock" ${st.stock ? 'checked' : ''}> In stock only</label>`;
    const list = visibleW();
    if (!list.length) { rows.innerHTML = `<tr><td colspan="9" class="empty">No wheels match these filters.</td></tr>`; }
    else {
      let html = '', last = null;
      for (const w of list) {
        if (w.group !== last) {
          last = w.group;
          html += w.group === 'direct' ? `<tr class="grp"><td colspan="9">Fits<span>bolt pattern matches, bore same or larger (rings added), OE diameter, offset within ${fees.et} mm</span></td></tr>`
            : `<tr class="grp"><td colspan="9">Fits with notes<span>plus/minus size, offset or width change, or missing specs</span></td></tr>`;
        }
        const notes = [];
        if (w.ring) notes.push(`<span class="chip ring">Ring ${w.cb}→${v.cb}</span>`);
        if (w.minus) notes.push(`<span class="chip d2">Minus ${w.ref.d - w.d}″</span>`);
        if (w.plus) notes.push(`<span class="chip d2">Plus ${w.d - w.ref.d}″</span>`);
        if (w.dEt) notes.push(`<span class="chip ${w.etWarn ? 'd2' : 'd1'}">ET ${sgn(w.dEt)}</span>`);
        if (w.dW) notes.push(`<span class="chip ${Math.abs(w.dW) > 0.5 ? 'd2' : 'd1'}">${sgn(w.dW)}″ W</span>`);
        if (w.lug) notes.push(`<span class="chip warn">${w.seat} lugs</span>`);
        for (const u of w.unknown) notes.push(`<span class="chip warn">no ${u}</span>`);
        if (!notes.length) notes.push('<span class="chip ok">OE spec</span>');
        html += `<tr class="row wrow${w.id === st.wsel ? ' sel' : ''}${w.qty === 0 ? ' zero' : ''}" data-wid="${w.id}">
          <td class="mono">${wsize(w)} <span style="color:var(--muted)">ET${q2(w.et)}</span></td>
          <td class="tname"><b>${esc(w.desc)}</b> <span>${esc(w.finish)}</span></td>
          <td><span class="chip ${w.type === 'Steel' ? 'steel' : 'alloy'}">${w.type}</span></td>
          <td>${w.used ? `Used${w.grade ? ` · <span class="mono">${w.grade}</span>` : ''}` : 'New'}</td>
          <td class="mono">${q2(w.cb)}</td>
          <td>${notes.join('')}</td>
          <td class="r mono ${w.qty ? '' : 'qty0'}">${w.qty}</td>
          <td class="r price">${money(w.price)}</td>
          <td><span class="loc">${esc(w.loc || '—')}</span></td></tr>`;
      }
      rows.innerHTML = html;
    }
    const exS = st.wex.filter(e => e.w.qty > 0);
    ex.innerHTML = exS.length ? `<div class="excl">Same bolt pattern but won't fit: ${exS.map(e => `<b>${wsize(e.w)} ET${q2(e.w.et)}</b> ${esc(e.w.desc)} (${esc(e.why)})`).join('; ')}</div>` : '';
  }

  function selected() { return st.rows.find(r => r.id === st.sel) || null; }
  function selectedW() { return st.wrows.find(w => w.id === st.wsel) || null; }
  function calc(r) {
    const q = st.qty, tires = (r.price ?? 0) * q, mount = fees.mount * q, disp = fees.disp * q, tpms = fees.tpmsOn ? fees.tpms * q : 0;
    const sub = tires + mount + disp + tpms, tax = sub * fees.tax / 100;
    return { q, tires, mount, disp, tpms, sub, tax, total: sub + tax };
  }
  function calcW(w) {
    const q = st.qty, wheels = (w.price ?? 0) * q, rings = w.ring ? fees.rings * Math.ceil(q / 4) : 0, lugs = w.lug ? fees.lugs : 0, sensors = st.sensors ? fees.sensor * q : 0;
    const sub = wheels + rings + lugs + sensors, tax = sub * fees.tax / 100;
    return { q, wheels, rings, lugs, sensors, sub, tax, total: sub + tax };
  }
  function vehLabel() { return st.mode === 'vehicle' ? `${st.veh.year} ${st.veh.v.make} ${st.veh.v.model}: ` : ''; }
  function quoteText(r, c) {
    return `${vehLabel()}${r.brand} ${r.model} ${r.size} ${q2(r.li)}${r.sr ?? ''}${r.used ? ` (used${r.tread != null ? `, ${r.tread}/32"` : ''})` : ''} x${c.q}. ${money(c.total)} out the door, includes mount & balance, disposal${fees.tpmsOn ? ', TPMS kit' : ''} and ${fees.tax}% HST.`;
  }
  function quoteTextW(w, c) {
    const extras = [w.ring && 'hub rings', w.lug && 'lug nuts', st.sensors && 'TPMS sensors'].filter(Boolean);
    return `${vehLabel()}${w.desc} ${wsize(w)} ET${q2(w.et)} ${st.veh.v.bolt}${w.used ? ` (used${w.grade ? ', grade ' + w.grade : ''})` : ' (new)'} x${c.q}. ${money(c.total)} out the door${extras.length ? ', includes ' + extras.join(', ') : ''} and ${fees.tax}% HST.`;
  }
  const qtyRow = () => `<div class="qtyrow" role="group" aria-label="Quantity">${[1, 2, 3, 4].map(n => `<button data-qty="${n}" aria-pressed="${st.qty === n}">${n}<kbd>${n}</kbd></button>`).join('')}</div>`;
  const pullBox = (loc, qty) => `<div class="pull"><div><small>Pull from</small><div class="where">${esc(loc || '—')}</div></div><div style="text-align:right"><small>On hand</small><div class="where mono" style="font-family:var(--mono);font-size:18px">${qty}</div></div></div>`;
  const totalBox = (c, unit) => `<div><div class="total"><span class="lbl">Out the door</span><span class="amt">${money(c.total)}</span></div><div class="per">${money(c.total / c.q)} per ${unit}</div></div>`;
  function renderQuote() { st.tab === 'tires' ? renderTireQuote() : renderWheelQuote(); }
  function renderTireQuote() {
    const el = $('quote'), r = selected();
    if (!r) { el.innerHTML = `<div><div class="eyebrow">Out-the-door quote</div><div class="gen">Pick a tire to price it installed.</div></div>`; return; }
    const c = calc(r), warns = [];
    if (r.price == null) warns.push(`<div class="bad">No price in the sheet for this line. The total leaves the tires out.</div>`);
    if (r.group === 'alt') warns.push(`<div class="pivot">Alternate size, ${r.delta > 0 ? '+' : '−'}${Math.abs(r.delta).toFixed(1)}% diameter. At an indicated 100 km/h the car will be doing ${(100 * (1 + r.delta / 100)).toFixed(1)} km/h.</div>`);
    if (r.qty < c.q) warns.push(`<div class="bad">Only ${r.qty} on hand. Short ${c.q - r.qty} for this quote.</div>`);
    if (r.srWarn) warns.push(`<div class="bad">Speed rating ${r.sr} is below OE ${st.oe.sr}.</div>`);
    if (r.used) warns.push(`<div>Used tire${r.tread != null ? `, ${r.tread}/32″ tread` : ''}${r.dot ? `, DOT ${r.dot}` : ''}. Inspect before quoting firm.</div>`);
    if (c.q === 2) warns.push(`<div>Pairs go on the rear axle.</div>`);
    el.innerHTML = `
      <div class="qhead"><div class="eyebrow">Tire quote${st.mode === 'vehicle' ? ' · ' + st.veh.year + ' ' + esc(st.veh.v.model) : ''}</div>
        <div class="tire">${esc(r.brand)} ${esc(r.model)}</div>
        <div class="spec">${r.size} ${q2(r.li)}${r.sr ?? ''}${r.xl ? ' XL' : ''} · ${SEASON[r.season] ?? 'Season not set'} · ${r.used ? 'Used' + (r.tread != null ? ' ' + r.tread + '/32″' : '') : 'New'}</div></div>
      ${pullBox(r.loc, r.qty)}${qtyRow()}
      <div class="lines">
        <span>Tires ${c.q} × ${money(r.price)}</span><span class="v">${money(c.tires)}</span>
        <span class="muted">Mount &amp; balance ${c.q} × ${money(fees.mount)}</span><span class="v muted">${money(c.mount)}</span>
        <span class="muted">Disposal ${c.q} × ${money(fees.disp)}</span><span class="v muted">${money(c.disp)}</span>
        ${fees.tpmsOn ? `<span class="muted">TPMS kit ${c.q} × ${money(fees.tpms)}</span><span class="v muted">${money(c.tpms)}</span>` : ''}
        <span class="sep"></span>
        <span>Subtotal</span><span class="v">${money(c.sub)}</span>
        <span class="muted">HST ${fees.tax}%</span><span class="v muted">${money(c.tax)}</span>
      </div>
      ${totalBox(c, 'tire installed')}
      ${warns.length ? `<div class="warns">${warns.join('')}</div>` : ''}
      <button class="primary" id="copy">Copy quote <kbd>C</kbd></button>
      <div class="copied" id="copied"></div>`;
  }
  function renderWheelQuote() {
    const el = $('quote'), w = selectedW();
    if (!w) { el.innerHTML = `<div><div class="eyebrow">Wheel quote</div><div class="gen">${st.mode === 'vehicle' ? 'Pick a wheel to price it.' : 'Search a vehicle to match wheels.'}</div></div>`; return; }
    const v = st.veh.v, c = calcW(w), warns = [];
    if (w.price == null) warns.push(`<div class="bad">No price in the sheet for this line. The total leaves the wheels out.</div>`);
    if (w.qty < c.q) warns.push(`<div class="bad">Only ${w.qty} on hand. Short ${c.q - w.qty} for this quote.</div>`);
    if (w.lug) warns.push(`<div class="bad">${esc(v.make)} OE lug nuts are ${SEAT[v.seat]}. These wheels need ${SEAT[w.seat]} seat${v.lug ? ', ' + esc(v.lug) : ''}. Lug set added.</div>`);
    if (w.ring) warns.push(`<div>Bore ${w.cb} mm on a ${v.cb} mm hub. Hub-centric rings ${w.cb}→${v.cb} are on the quote.</div>`);
    if (w.unknown.length) warns.push(`<div class="bad">The sheet has no ${w.unknown.join(', ')} for this wheel. Measure before quoting.</div>`);
    if (w.minus) warns.push(`<div class="pivot">Minus-size ${w.d}″ wheel. Test-fit over the brake calipers before mounting.</div>`);
    if (w.plus) warns.push(`<div class="pivot">Plus-size ${w.d}″ wheel. Needs a lower-profile tire to keep overall diameter.</div>`);
    if (w.etWarn) warns.push(`<div class="pivot">Offset ${w.et} vs OE ${w.ref.et} (${sgn(w.dEt)} mm). Check strut and fender clearance.</div>`);
    if (w.grade === 'C') warns.push(`<div>${GRADE.C}. Show the customer before they commit.</div>`);
    const tireLine = w.tire ? `Takes <b class="mono">${w.tire.key}</b>${w.tire.delta ? ` (${w.tire.delta > 0 ? '+' : '−'}${Math.abs(w.tire.delta).toFixed(1)}% vs OE)` : ''}` : `No ${w.d}″ tire in stock within ±${fees.tol}% of OE diameter. Special order.`;
    const oeIdx = v.oe.findIndex(o => parseSize(o[0]).r === w.d);
    el.innerHTML = `
      <div class="qhead"><div class="eyebrow">Wheel quote · ${st.veh.year} ${esc(v.model)}</div>
        <div class="tire">${esc(w.desc)}</div>
        <div class="spec">${wsize(w)} ET${q2(w.et)} · ${esc(w.pcd)} · CB ${q2(w.cb)} · ${w.grade ? GRADE[w.grade] : w.used ? 'Used' : 'New'}</div></div>
      ${pullBox(w.loc, w.qty)}${qtyRow()}
      <div class="lines">
        <span>Wheels ${c.q} × ${money(w.price)}</span><span class="v">${money(c.wheels)}</span>
        ${w.ring ? `<span class="muted">Hub rings ${w.cb}→${v.cb}</span><span class="v muted">${money(c.rings)}</span>` : ''}
        ${w.lug ? `<span class="muted">Lug nut set, ${w.seat} seat</span><span class="v muted">${money(c.lugs)}</span>` : ''}
        ${st.sensors ? `<span class="muted">TPMS sensors ${c.q} × ${money(fees.sensor)}</span><span class="v muted">${money(c.sensors)}</span>` : ''}
        <span class="sep"></span>
        <span>Subtotal</span><span class="v">${money(c.sub)}</span>
        <span class="muted">HST ${fees.tax}%</span><span class="v muted">${money(c.tax)}</span>
      </div>
      <label class="opt"><input type="checkbox" id="wsensors" ${st.sensors ? 'checked' : ''}> Add TPMS sensors (dash light stays on without them)</label>
      ${totalBox(c, 'wheel')}
      <div class="warns"><div>${tireLine}</div>${warns.join('')}</div>
      ${oeIdx >= 0 && visible().length ? `<button class="ghost" id="toTires" data-oeidx="${oeIdx}">Show ${v.oe[oeIdx][0]} tires for this wheel</button>` : ''}
      <button class="primary" id="copy">Copy quote <kbd>C</kbd></button>
      <div class="copied" id="copied"></div>`;
  }

  // ---------- Actions ----------
  function moveSel(dir) {
    const W = st.tab === 'wheels', v = W ? visibleW() : visible(); if (!v.length) return;
    const cur = W ? st.wsel : st.sel;
    let i = v.findIndex(r => r.id === cur); i = i < 0 ? 0 : Math.max(0, Math.min(v.length - 1, i + dir));
    if (W) st.wsel = v[i].id; else st.sel = v[i].id;
    renderStock(); renderQuote();
    const row = document.querySelector(W ? `tr.wrow[data-wid="${st.wsel}"]` : `tr.row[data-id="${st.sel}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
  }
  function setQty(n) { st.qty = n; renderQuote(); }
  function copyQuote() {
    let txt;
    if (st.tab === 'wheels') { const w = selectedW(); if (!w) return; txt = quoteTextW(w, calcW(w)); }
    else { const r = selected(); if (!r) return; txt = quoteText(r, calc(r)); }
    flush();
    const out = $('copied');
    const fallback = () => { out.innerHTML = `<textarea id="fallback" rows="4" readonly>${esc(txt)}</textarea>`; const ta = $('fallback'); ta.focus(); ta.select(); };
    try { navigator.clipboard.writeText(txt).then(() => { out.textContent = 'Copied. Paste into a text or read it out.'; }).catch(fallback); } catch (e) { fallback(); }
  }
  function saveFees() { try { localStorage.setItem('gct-fees', JSON.stringify(fees)); } catch (e) {} }

  on(document, 'click', e => {
    const ord = e.target.closest('a[data-order]');
    if (ord) { copyForOrder(ord.dataset.order, ord.dataset.filled === 'true'); return; }
    const b = e.target.closest('[data-v],[data-s],[data-oe],[data-tab],[data-season],[data-cond],[data-wtype],[data-wcond],[data-qty],tr.wrow,tr.row,#copy,#copySize,#toTires'); if (!b) return;
    if (b.dataset.v) { $('qv').value = b.dataset.v; searchVehicle(b.dataset.v); }
    else if (b.dataset.s) { $('qs').value = b.dataset.s; searchSize(b.dataset.s); }
    else if (b.dataset.oe) setOE(+b.dataset.oe);
    else if (b.dataset.tab) setTab(b.dataset.tab);
    else if (b.dataset.season) { st.season = b.dataset.season; autoSelect(); render(); }
    else if (b.dataset.cond) { st.cond = b.dataset.cond; autoSelect(); render(); }
    else if (b.dataset.wtype) { st.wtype = b.dataset.wtype; autoSelect(); render(); }
    else if (b.dataset.wcond) { st.wcond = b.dataset.wcond; autoSelect(); render(); }
    else if (b.dataset.qty) setQty(+b.dataset.qty);
    else if (b.id === 'copy') copyQuote();
    else if (b.id === 'copySize') {
      const t = b.dataset.size, o = $('sizeCopied'); o.hidden = false;
      try { navigator.clipboard.writeText(t).then(() => { o.textContent = 'Size copied.'; }).catch(() => { o.textContent = 'Select and copy: ' + t; }); } catch (err) { o.textContent = 'Select and copy: ' + t; }
    }
    else if (b.id === 'toTires') { const keep = st.wsel; st.tab = 'tires'; setOE(+b.dataset.oeidx); st.wsel = keep; renderQuote(); }
    else if (b.matches('tr.wrow')) { st.wsel = +b.dataset.wid; flush(); renderStock(); renderQuote(); }
    else if (b.matches('tr.row')) { st.sel = +b.dataset.id; flush(); renderStock(); renderQuote(); }
  });
  on(document, 'change', e => {
    if (e.target.id === 'instock') { st.stock = e.target.checked; autoSelect(); render(); }
    else if (e.target.id === 'wsensors') { st.sensors = e.target.checked; renderQuote(); }
  });

  on($('qv'), 'input', e => searchVehicle(e.target.value));
  on($('qs'), 'input', e => searchSize(e.target.value));
  const focusBox = id => { const el = $(id); el.focus(); el.select(); };
  on(document, 'keydown', e => {
    if (e.target.id === 'qv' || e.target.id === 'qs') {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); flush(); if (!st.sel) autoSelect(); $('tablewrap').focus({ preventScroll: true }); render(); }
      else if (e.key === 'Escape') { e.target.select(); }
      return;
    }
    if (e.target.matches('input,textarea,select')) return;
    const k = e.key.toLowerCase();
    if (k === 'v' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); focusBox('qv'); }
    else if (k === 's' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); focusBox('qs'); }
    else if (e.key === '/' || ((e.metaKey || e.ctrlKey) && k === 'k')) { e.preventDefault(); focusBox(lastBox); }
    else if (k === 't' && !e.metaKey && !e.ctrlKey) setTab('tires');
    else if (k === 'w' && !e.metaKey && !e.ctrlKey) setTab('wheels');
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (/^[1-4]$/.test(e.key)) setQty(+e.key);
    else if ((e.key === '[' || e.key === ']') && st.mode === 'vehicle') setOE(st.oeIdx + (e.key === ']' ? 1 : -1));
    else if (k === 'c' && !e.metaKey && !e.ctrlKey) copyQuote();
    else if (k === 'o' && !e.metaKey && !e.ctrlKey) { const a = $('orderTc'); if (a) { window.open(a.href, '_blank', 'noopener'); copyForOrder(a.dataset.order, a.dataset.filled === 'true'); } }
    else if (e.key === 'Escape') { focusBox(lastBox); }
  });

  // fee inputs
  const FEE_IDS = { mount: 'f-mount', disp: 'f-disp', tpms: 'f-tpms', rings: 'f-rings', lugs: 'f-lugs', sensor: 'f-sensor', tax: 'f-tax', tol: 'f-tol', et: 'f-et' };
  for (const [k, id] of Object.entries(FEE_IDS)) {
    const inp = $(id); inp.value = fees[k];
    on(inp, 'input', () => { const n = parseFloat(inp.value); if (isNaN(n) || n < 0) return; fees[k] = n; saveFees(); if (k === 'tol' || k === 'et') { compute(); autoSelect(); renderStock(); } renderQuote(); });
  }
  $('f-tpmsOn').checked = fees.tpmsOn;
  on($('f-tpmsOn'), 'change', e => { fees.tpmsOn = e.target.checked; saveFees(); renderQuote(); });
  const tcStatus = () => {
    const v = $('f-tc').value.trim(), el = $('f-tc-status');
    if (!v) { el.textContent = data.fees.tc ? 'Using the shop-wide TireConnect address.' : ''; return; }
    if (!isHttpUrl(v)) { el.textContent = 'That doesn\'t look like a web address. Copy it from the address bar.'; return; }
    el.textContent = hasSlots(exampleToTemplate(v)) ? 'Size found in the address: each order opens with the size filled in.'
      : 'No 225/65R17 found in the address: the button opens TireConnect and copies the size to paste.';
  };
  $('f-tc').value = fees.tc === data.fees.tc ? '' : fees.tc;
  $('f-tc').placeholder = data.fees.tc ? 'Shop-wide address set. Paste one to override on this PC.' : 'Paste a TireConnect search address';
  tcStatus();
  on($('f-tc'), 'input', () => { fees.tc = $('f-tc').value.trim() || data.fees.tc || ''; saveFees(); tcStatus(); if (st.tab === 'tires') renderSpecial(); });
  for (let i = 0; i < 3; i++) {
    const d = (fees.dist && fees.dist[i]) || { name: '', url: '' };
    $('dn' + i).value = d.name; $('du' + i).value = d.url;
    const upd = () => { fees.dist = fees.dist || []; fees.dist[i] = { name: $('dn' + i).value.trim(), url: $('du' + i).value.trim() }; saveFees(); if (st.tab === 'tires') renderSpecial(); };
    on($('dn' + i), 'input', upd); on($('du' + i), 'input', upd);
  }

  // header and examples
  $('status').innerHTML = `<span class="dot${data.mode === 'live' ? ' live' : ''}"></span>${esc(data.status)} · <a href="/sync">sync</a> · <a href="/import">import</a>`;
  $('triesV').innerHTML = 'Try: ' + data.tries.vehicles.map(v => `<button data-v="${esc(v)}">${esc(v)}</button>`).join('');
  $('triesS').innerHTML = 'Try: ' + data.tries.sizes.map(s => `<button data-s="${esc(s)}">${esc(s)}</button>`).join('');

  // Demo starts in a realistic working state. Live starts empty so a page load never spends a Wheel-Size hit.
  if (data.mode === 'demo') { $('qv').value = '18 outback'; searchVehicle('18 outback'); }
  else { render(); $('qv').focus(); }

  return () => { ac.abort(); clearTimeout(vtimer); };
}
