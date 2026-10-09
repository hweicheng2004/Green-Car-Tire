// Counter screen logic, ported from the clickable prototype. Plain DOM code: React renders the markup once
// (components/counter/markup.ts) and this fills the panes. Data comes from the server (lib/counter-data.ts shapes):
//   data      CounterInventory: tires, wheels, fees, status line, "Try:" examples
//   api       { vehicle(q) -> VehicleResult, oeOn(size) -> [{label, q}] }
//   log/flush search logging (lib/log-search-client.ts); no-ops in demo mode
// Returns a cleanup function that removes every listener (React runs effects twice in development).

import { exampleToTemplate, fillTemplate, hasSlots, isHttpUrl } from './order-link';
import { parseYear, compact } from '../../lib/vehicle-query';

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

/** @param {{ data: any, api: { vehicle: (ask: any, lookup?: boolean) => Promise<any>, catalog: () => Promise<any[]>, oeOn: (size: string) => Promise<any[]> }, log?: (s: any) => void, flush?: () => void }} opts */
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
    tab: 'tires', wrows: [], wex: [], wsel: null, wtype: 'all', wcond: 'all', sensors: false, query: '', subject: null };
  let vseq = 0, vtimer = null;
  // A new vehicle or size is a new customer: quantity goes back to a set of 4. Switching OE size on the same vehicle keeps it.
  function setSubject(k) { if (k !== st.subject) { st.subject = k; st.qty = 4; } }

  // ---------- Fitment math ----------
  function compute() { computeTires(); computeWheels(); }
  // Nothing searched (first load, after Clear, or while still typing): browse the whole inventory, grouped by size.
  const browsing = () => st.mode === 'none';
  const bySize = (a, b) => a.s.r - b.s.r || a.s.w - b.s.w || a.s.a - b.s.a;
  function computeTires() {
    const tgt = st.target, oe = st.oe; st.rows = []; st.excluded = [];
    if (!tgt) {
      if (browsing()) st.rows = INV.map(t => ({ ...t, group: 'size:' + t.size, delta: 0, srWarn: false }))
        .sort((a, b) => bySize(a, b) || Number(a.used) - Number(b.used) || (a.price ?? 1e9) - (b.price ?? 1e9));
      return;
    }
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
    if (browsing()) {
      st.wrows = WHL.map(w => ({ ...w, group: 'dia:' + w.d, ring: false, minus: false, plus: false, etWarn: false, lug: false, unknown: [], dW: 0, dEt: 0, cur: false, tire: null, ref: null }))
        .sort((a, b) => a.d - b.d || a.pcd.localeCompare(b.pcd) || Number(a.used) - Number(b.used) || (a.price ?? 1e9) - (b.price ?? 1e9));
      return;
    }
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
    if (browsing()) { st.sel = null; st.wsel = null; return; }   // browsing: nothing is quoted until someone picks a line
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
  // Vehicle: three boxes (year, make, model). A lookup fires only once all three are filled in and the model is a
  // real one (picked from the list, or Enter takes the closest). Saved vehicles show instantly; an unsaved one opens
  // the popup, and Wheel-Size is only called after someone confirms it.
  let lastBox = 'qv';
  const VBOX = ['qv', 'qmk', 'qmd'];
  const isVBox = id => VBOX.includes(id);
  let catalog = [];          // [{ slug, name, models: [{ slug, name }] }]
  let pending = null;        // the needsLookup prompt currently shown
  let pendingPick = 0;
  function setActive(id) {
    lastBox = id;
    $('qv').closest('.field').classList.toggle('active', isVBox(id));
    $('qs').closest('.field').classList.toggle('active', id === 'qs');
  }
  function clearBox(id) {
    for (const x of isVBox(id) ? VBOX : [id]) $(x).value = '';
    const p = $(isVBox(id) ? 'parseV' : 'parseS'); p.className = 'parse none'; p.textContent = '—';
    if (isVBox(id)) hidePopup();
  }
  function showNone(label, failed = false) {
    Object.assign(st, { mode: 'none', veh: null, target: null, oe: null });
    const p = $('parseV'); p.className = failed ? 'parse bad' : 'parse none'; p.textContent = label;
    compute(); autoSelect(); render();
  }
  const findMake = text => { const c = compact(text); return c ? catalog.find(m => compact(m.name) === c || compact(m.slug) === c) : null; };
  const modelMatches = (mk, text) => {
    const c = compact(text); if (!mk || !c) return [];
    return mk.models.filter(m => compact(m.name).startsWith(c) || compact(m.slug).startsWith(c))
      .sort((a, b) => Number(compact(b.name) === c || compact(b.slug) === c) - Number(compact(a.name) === c || compact(a.slug) === c) || a.name.length - b.name.length);
  };
  function fillModelList() {
    const mk = findMake($('qmk').value);
    $('dlModel').innerHTML = (mk ? mk.models : []).map(m => `<option value="${esc(m.name)}"></option>`).join('');
  }
  /** Reads the three boxes. `force` (Enter) completes a partial model to the closest match. */
  function searchVehicle(force = false) {
    setActive(lastBox && isVBox(lastBox) ? lastBox : 'qv'); clearBox('qs');
    const seq = ++vseq; clearTimeout(vtimer); hidePopup();
    const yText = $('qv').value.trim(), mText = $('qmk').value.trim(), mdText = $('qmd').value.trim();
    const year = parseYear(yText);
    st.query = [yText, mText, mdText].filter(Boolean).join(' '); st.lastKind = 'vehicle';
    if (!yText && !mText && !mdText) return showNone('—');
    if (parseSize(st.query)) return showNone('That’s a size →');
    const mk = catalog.length ? findMake(mText) : null;
    // Not in the make/model list: keep typing, or press Enter to look it up by the typed name.
    if (catalog.length && mText && !mk && !force) return showNone(catalog.some(m => compact(m.name).startsWith(compact(mText))) ? 'Pick a make' : 'Not in list · ↵');
    if (!mdText) return showNone(mText ? 'Add the model' : 'Add the make');
    let model = mdText;
    if (mk) {
      const ms = modelMatches(mk, mdText);
      const exact = ms.find(m => compact(m.name) === compact(mdText) || compact(m.slug) === compact(mdText));
      if (!ms.length && !force) return showNone('Not in list · ↵');
      if (ms.length && !exact && !force) return showNone(ms.length === 1 ? `↵ ${ms[0].name}` : 'Pick a model');
      if (ms.length) { model = (exact || ms[0]).slug; if (!exact) $('qmd').value = ms[0].name; }
    }
    if (!yText) return showNone('Add the year');
    if (year === null) return showNone('Year?');
    const ask = { year, make: mk ? mk.slug : mText, model };
    const key = `${ask.year}|${compact(ask.make)}|${compact(ask.model)}`;
    if (VEHCACHE.has(key)) return applyVehicle(VEHCACHE.get(key));
    const p = $('parseV'); p.className = 'parse none'; p.textContent = '…';
    vtimer = setTimeout(() => {
      api.vehicle(ask).then(r => {
        if (r.vehicle || r.miss) VEHCACHE.set(key, r);   // "not saved yet" isn't cached: it changes once looked up
        if (seq === vseq) applyVehicle(r, force);
      }).catch(() => { if (seq === vseq) showNone('Lookup failed', true); });
    }, force ? 0 : 200);
  }
  /** `fromEnter`: the search came from Enter, so a "not saved yet" popup takes focus (typing never loses it). */
  function applyVehicle(r, fromEnter = false) {
    const p = $('parseV');
    hidePopup();
    if (r.needsLookup) {
      const n = r.needsLookup;
      setSubject(`v|${n.year}|${n.makeSlug}|${n.modelSlug}`);
      Object.assign(st, { mode: 'lookup', veh: n, target: null, oe: null });
      p.className = 'parse none'; p.textContent = n.keyMissing ? 'Not saved yet' : quotaOut(n) ? 'No lookups left' : 'Not saved yet';
      compute(); autoSelect(); render(); showPopup(n, fromEnter);
      return;   // logged once looked up, or not at all if cancelled
    }
    if (r.vehicle && r.vehicle.oe.length) {
      const v = r.vehicle;
      setSubject(`v|${v.year}|${v.makeSlug}|${v.modelSlug}`);
      Object.assign(st, { mode: 'vehicle', veh: { v, year: v.year, assumed: v.assumed }, oeIdx: 0 }); setOE(0, false);
      p.className = 'parse veh'; p.textContent = `${v.year} ${v.make} ${v.model}`;
    } else if (r.vehicle || r.miss) {
      const m = r.miss || { year: r.vehicle.year, label: `${r.vehicle.make} ${r.vehicle.model}`, why: 'No tire sizes on file for this vehicle. Check the door placard.' };
      setSubject(`m|${m.year}|${m.label}`);
      Object.assign(st, { mode: 'miss', veh: m, target: null, oe: null });
      p.className = 'parse none'; p.textContent = 'No fitment';
    } else {
      Object.assign(st, { mode: 'none', veh: null, target: null, oe: null });
      p.className = r.error ? 'parse bad' : 'parse none'; p.textContent = r.error ? 'Lookup failed' : 'No match';
    }
    compute(); autoSelect(); render(); logCurrent();
  }
  // ---------- Wheel-Size confirm popup ----------
  // Lookups cost money, so spending one takes two deliberate steps: Enter in a box only moves focus onto "Look it up"
  // (nothing is spent), and Enter there confirms. For a moment after focus lands, Enter is ignored, so a reflexive
  // double Enter never spends. With too few lookups left, the popup offers the size search instead.
  let armedAt = 0;
  const quotaOut = n => n.hitsToday != null && n.dailyLimit - n.hitsToday < n.hitsNeeded;
  const blocked = n => !!n.keyMissing || quotaOut(n);   // no lookup possible: offer the size search instead
  const popupHasFocus = () => { const el = $('lookupPop'); return !!el && el.contains(document.activeElement); };
  function focusPopup() {
    const b = $('lookupGo') || $('lookupSize'); if (!b) return;
    b.focus(); armedAt = Date.now() + 450;
  }
  function showPopup(n, takeFocus = false) {
    pending = n; pendingPick = Math.max(0, n.options.findIndex(o => o.makeSlug === n.makeSlug && o.modelSlug === n.modelSlug));
    renderPopup();
    if (takeFocus) focusPopup();
  }
  function renderPopup(busy = '') {
    const el = $('lookupPop'), n = pending; if (!n) return;
    const hadFocus = popupHasFocus(), out = blocked(n);
    const o = n.options[pendingPick] || { label: n.label };
    const leftN = n.hitsToday == null ? null : Math.max(0, n.dailyLimit - n.hitsToday);
    const left = leftN == null ? '' : ` ${leftN} of ${n.dailyLimit} left today.`;
    el.setAttribute('aria-labelledby', 'lookupTitle');
    const unlisted = n.unlisted ? `<p class="note">${catalog.length ? 'Not in your make/model list. Check the spelling: a lookup with a wrong name still uses the lookups.'
      : 'The make/model list isn\'t loaded yet (see Setup), so check the spelling first: a wrong name still uses the lookups.'}</p>` : '';
    el.innerHTML = out
      ? `<h3 id="lookupTitle">${n.year} ${esc(o.label)} isn't saved yet</h3>
      <p class="out">${n.keyMissing ? 'Wheel-Size isn\'t connected yet (WHEELSIZE_API_KEY isn\'t set in Vercel), so new vehicles can\'t be looked up.'
        : `No Wheel-Size lookups left today (${leftN} of ${n.dailyLimit}).`} Search the size off the driver's door placard instead. Saved vehicles still work.</p>
      <div class="acts"><button class="go" id="lookupSize">Search a size <kbd>S</kbd></button><button id="lookupNo">Not now <kbd>Esc</kbd></button></div>`
      : `<h3 id="lookupTitle">${n.year} ${esc(o.label)} isn't saved yet</h3>
      <p>Look it up on Wheel-Size? Uses ${n.hitsNeeded} lookup${n.hitsNeeded === 1 ? '' : 's'}.${left} Once saved, it's free for everyone.</p>${unlisted}
      ${n.options.length > 1 ? `<div class="opts" role="group" aria-label="Which model (arrow keys)">${n.options.map((x, i) => `<button data-pick="${i}" aria-pressed="${i === pendingPick}">${esc(x.label)}</button>`).join('')}</div>` : ''}
      ${busy ? `<p role="status">${esc(busy)}</p>` : `<div class="acts"><button class="go" id="lookupGo">Look it up <kbd>↵</kbd></button><button id="lookupNo">Not now <kbd>Esc</kbd></button></div>`}`;
    el.hidden = false;
    if (hadFocus) { const b = $('lookupGo') || $('lookupSize'); if (b) b.focus(); }   // a re-render keeps focus in the popup
  }
  function hidePopup() { pending = null; const el = $('lookupPop'); if (el) { el.hidden = true; el.innerHTML = ''; } }
  function pickModel(i) {
    const n = pending; if (!n || n.options.length < 2) return;
    pendingPick = (i + n.options.length) % n.options.length; renderPopup();
  }
  /** Out of lookups (or the size is quicker): drop the popup and go to the size box. */
  function sizeInstead() {
    const n = pending; if (!n) return;
    hidePopup();
    Object.assign(st, { mode: 'miss', veh: { year: n.year, label: n.label, why: n.keyMissing ? 'Wheel-Size isn\'t connected.' : quotaOut(n) ? 'No Wheel-Size lookups left today.' : 'Not looked up.' } });
    render(); focusBox('qs');
  }
  function confirmLookup() {
    const n = pending; if (!n || blocked(n)) return;
    const o = n.options[pendingPick] || { makeSlug: n.makeSlug, modelSlug: n.modelSlug };
    const seq = ++vseq;
    renderPopup('Looking it up on Wheel-Size…');
    api.vehicle({ year: n.year, make: o.makeSlug, model: o.modelSlug }, true).then(r => {
      if (seq !== vseq) return;
      if (r.vehicle) {
        VEHCACHE.set(`${n.year}|${compact(o.makeSlug)}|${compact(o.modelSlug)}`, r);
        const mk = catalog.find(m => m.slug === o.makeSlug), md = mk && mk.models.find(m => m.slug === o.modelSlug);
        if (md) $('qmd').value = md.name;
      }
      const wasFocused = popupHasFocus();
      applyVehicle(r.needsLookup ? { miss: { year: n.year, label: o.label, why: 'Wheel-Size lookup failed. Check the door placard.' } } : r);
      if (wasFocused || document.activeElement === document.body) $('tablewrap').focus({ preventScroll: true });   // on to the results, like Enter
      flush();
    }).catch(() => { if (seq === vseq) { hidePopup(); showNone('Lookup failed', true); } });
  }
  function cancelLookup() {
    if (!pending) return;
    const n = pending, wasFocused = popupHasFocus(); hidePopup();
    Object.assign(st, { mode: 'miss', veh: { year: n.year, label: n.label, why: 'Not looked up. Press Enter in the model box to look it up with Wheel-Size.' } });
    render();
    if (wasFocused) $('qmd').focus();
  }
  /** Clear button / N: empty all four boxes and reset the screen for the next customer. */
  function newCustomer() {
    flush(); ++vseq; clearTimeout(vtimer); typed = null;
    clearBox('qv'); clearBox('qs');
    Object.assign(st, { mode: 'none', veh: null, target: null, oe: null, query: '', subject: null, qty: 4, season: 'all', cond: 'all',
      stock: true, tab: 'tires', sel: null, wsel: null, wtype: 'all', wcond: 'all', sensors: false });
    fillModelList(); compute(); autoSelect(); render();
    lastBox = 'qv'; setActive('qv'); $('qv').focus();
  }
  /** Fills the three boxes from a "Try:" or "OE on" button: { year, make (slug), model (slug) }. */
  function setVehicle(y, makeSlug, modelSlug) {
    const mk = catalog.find(m => m.slug === makeSlug), md = mk && mk.models.find(m => m.slug === modelSlug);
    $('qv').value = String(y); $('qmk').value = mk ? mk.name : makeSlug; $('qmd').value = md ? md.name : modelSlug;
    fillModelList(); lastBox = 'qv'; searchVehicle(true);
  }
  function searchSize(q) {
    setActive('qs'); clearBox('qv'); ++vseq; clearTimeout(vtimer);
    const p = $('parseS'); q = q.trim();
    st.query = q; st.lastKind = 'size';
    const size = q ? parseSize(q) : null;
    if (size) {
      setSubject(`s|${size.key}`);
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
      el.innerHTML = `<div><h2>${year} ${esc(v.make)} ${esc(v.model)}</h2>
        <div class="gen">${v.gen ? esc(v.gen) + ' generation' : ''}${assumed ? ' · no year typed, assuming latest' : ''}</div></div>
        <div><div class="eyebrow">OE sizes · pick by trim</div><div class="oe">${v.oe.map((o, i) => { const n = onHand(o[0]); return `
          <button data-oe="${i}" aria-pressed="${i === st.oeIdx}"><span class="sz">${o[0]} <span class="lisr">${q2(o[1])}${o[2] ?? ''}</span></span>
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
      el.innerHTML = `<div><h2 class="sizeh">${s.key}</h2>
        <div class="gen">Direct size lookup</div></div>
        <div><div class="eyebrow">Geometry</div><dl><dt>Overall diameter</dt><dd>${d.toFixed(1)}″ · ${mm.toFixed(0)} mm</dd>
        <dt>Section width</dt><dd>${s.w} mm · ${(s.w / 25.4).toFixed(1)}″</dd><dt>Sidewall</dt><dd>${(s.w * s.a / 100).toFixed(0)} mm</dd>
        <dt>Revs / km</dt><dd>${(1e6 / (Math.PI * mm)).toFixed(0)}</dd><dt>Rim</dt><dd>${s.r}″</dd></dl></div>
        <div><div class="eyebrow">OE on</div>${!fits ? '<div class="gen">Looking up…</div>' : fits.length
          ? `<div class="fitlist">${fits.map(f => `<button data-y="${f.year}" data-mk="${esc(f.make)}" data-md="${esc(f.model)}">${esc(f.label)}</button>`).join('')}</div>`
          : `<div class="gen">${data.mode === 'demo' ? 'No sample vehicles use this size.' : 'No vehicle looked up so far came on this size. The list grows as the counter is used.'}</div>`}</div>
        <div class="note">No vehicle selected, so load index isn't checked. Match it to the customer's door placard. Wheels need a vehicle search.</div>`;
    } else if (st.mode === 'lookup') {
      el.innerHTML = `<div><h2>${st.veh.year} ${esc(st.veh.label)}</h2></div>
        <div class="gen">${st.veh.keyMissing ? 'Not saved yet, and Wheel-Size isn\'t connected (WHEELSIZE_API_KEY). Search the size off the door placard (S).' : quotaOut(st.veh) ? 'Not saved yet, and no Wheel-Size lookups are left today. Search the size off the door placard (S).'
          : 'Not saved yet. Confirm the Wheel-Size lookup above, or search the size off the door placard.'}</div>`;
    } else if (st.mode === 'miss') {
      el.innerHTML = `<div><h2>${st.veh.year ?? ''} ${esc(st.veh.label)}</h2></div><div class="gen">${esc(st.veh.why || 'No fitment on file for this year.')} ${/placard/i.test(st.veh.why || '') ? 'Search the size directly (S).' : 'Check the door placard and search the size directly (S).'}</div>`;
    } else {
      el.innerHTML = `<div><div class="eyebrow">Fitment</div><div class="gen">Type a year and model, like <span class="mono">21 rav4</span>, or a size off the sidewall, like <span class="mono">225 65 17</span>.</div></div>`;
    }
  }

  function renderTabs() {
    const tn = st.target || browsing() ? visible().length : 0, wn = st.mode === 'vehicle' || browsing() ? visibleW().length : null;
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
      <div><div class="eyebrow so-label">No new tire in stock · special order</div>
        <div class="sosize">${s.key}</div>
        <div class="gen">${st.oe && st.oe.li != null ? `Order load ${st.oe.li}${st.oe.sr ?? ''} or higher. ` : ''}${usedIn ? 'Used or alternate stock is listed below if the customer can\'t wait.' : 'Nothing on the shelf to pivot to.'}</div></div>
      <div class="soact">${tcLink(s)}${links.join('')}
        ${tcOn() ? '' : `<a href="https://www.google.com/search?q=${encodeURIComponent(s.key + ' tire')}" target="_blank" rel="noopener">Search web ↗</a>`}
        <button id="copySize" data-size="${s.key}">Copy size</button></div>
      ${tcOn() ? '' : '<div class="feehint flush">Add your TireConnect address under Shop fees &amp; rules to order in one click.</div>'}
      <div class="gen so-copied" id="sizeCopied" role="status" hidden></div>
    </div>`;
  }

  function renderTires() {
    const rows = $('rows'), ban = $('banner'), fil = $('filters'), ex = $('excl');
    const browse = !st.target && browsing();
    if (!st.target && !browse) { ban.innerHTML = ''; fil.innerHTML = ''; ex.innerHTML = ''; rows.innerHTML = `<tr><td colspan="9" class="empty">Search a vehicle or size to see what's on the shelf.</td></tr>`; return; }
    const key = st.target ? st.target.key : '';
    const exactIn = st.rows.filter(r => r.group === 'exact' && r.qty > 0), altIn = st.rows.filter(r => r.group === 'alt' && r.qty > 0);
    const sumQ = a => a.reduce((n, r) => n + r.qty, 0);
    if (browse) {
      const inS = st.rows.filter(r => r.qty > 0);
      ban.innerHTML = `<div class="banner info"><b>All tires</b> ${sumQ(inS)} on hand in ${new Set(inS.map(r => r.size)).size} sizes. Type a vehicle or size to narrow it down.</div>`;
    }
    else if (exactIn.length) ban.innerHTML = `<div class="banner ok"><b>${key}</b> ${sumQ(exactIn)} on hand across ${exactIn.length} line${exactIn.length > 1 ? 's' : ''}${altIn.length ? ` · ${altIn.length} safe alternate line${altIn.length > 1 ? 's' : ''} too` : ''}</div>`;
    else if (altIn.length) ban.innerHTML = `<div class="banner pivot"><b>${key}</b> is out of stock. ${sumQ(altIn)} tires in ${altIn.length} safe alternate line${altIn.length > 1 ? 's' : ''} within ±${fees.tol}% diameter.</div>`;
    else ban.innerHTML = `<div class="banner info"><b>${key}</b> Nothing on hand in this size or a safe alternate. Quote a special order.</div>`;

    const base = st.rows.filter(r => (!st.stock || r.qty > 0));
    const cnt = s => base.filter(r => s === 'all' || r.season === s).length;
    const segS = [['all', 'All'], ['W', 'Winter'], ['AW', 'All-weather'], ['AS', 'All-season'], ['S', 'Summer']].map(([k, l]) => `<button data-season="${k}" aria-pressed="${st.season === k}">${l}<span class="n">${cnt(k)}</span></button>`).join('');
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
          const sz = r.group.startsWith('size:') ? st.rows.filter(x => x.size === r.size && x.qty > 0) : null;
          html += sz ? `<tr class="grp"><td colspan="9">${r.size}<span>${sumQ(sz)} on hand</span></td></tr>`
            : r.group === 'exact' ? `<tr class="grp"><td colspan="9">${st.mode === 'vehicle' ? 'OE size' : 'Exact size'}<span>${key}</span></td></tr>`
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
    const browse = browsing();
    if (st.mode !== 'vehicle' && !browse) {
      ban.innerHTML = `<div class="banner info">Wheels are matched by bolt pattern and center bore. Search a year, make and model.</div>`;
      fil.innerHTML = ''; ex.innerHTML = ''; rows.innerHTML = `<tr><td colspan="9" class="empty">Type a vehicle in the year · make · model box.</td></tr>`; return;
    }
    const v = browse ? {} : st.veh.v, inS = st.wrows.filter(w => w.qty > 0);
    const dn = inS.filter(w => w.group === 'direct').length, an = inS.length - dn, rn = inS.filter(w => w.group === 'direct' && w.ring).length;
    const spec = `${esc(v.bolt ?? 'bolt pattern unknown')}${v.cb != null ? ` · ${v.cb} mm bore` : ''}`;
    ban.innerHTML = browse ? `<div class="banner info"><b>All wheels</b> ${inS.reduce((n, w) => n + w.qty, 0)} on hand in ${inS.length} lines. Add the customer's vehicle to see what fits.</div>`
      : !v.bolt ? `<div class="banner info">No bolt pattern on file for this vehicle, so wheels can't be matched.</div>`
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
          html += w.group.startsWith('dia:') ? `<tr class="grp"><td colspan="9">${w.d}″ wheels<span>${st.wrows.filter(x => x.d === w.d && x.qty > 0).reduce((n, x) => n + x.qty, 0)} on hand</span></td></tr>`
            : w.group === 'direct' ? `<tr class="grp"><td colspan="9">Fits<span>bolt pattern matches, bore same or larger (rings added), OE diameter, offset within ${fees.et} mm</span></td></tr>`
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
        if (browse) notes.push(`<span class="chip">${esc(w.pcd)}</span>`);
        else if (!notes.length) notes.push('<span class="chip ok">OE spec</span>');
        html += `<tr class="row wrow${w.id === st.wsel ? ' sel' : ''}${w.qty === 0 ? ' zero' : ''}" data-wid="${w.id}">
          <td class="mono">${wsize(w)} <span class="et">ET${q2(w.et)}</span></td>
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
  // Quote caveats. One list feeds the pane and the copied text, so what gets read out or texted to the customer can
  // never drop a caveat the screen shows. Each: { text (on screen), say (in the copied quote; null = screen only),
  // cls ('bad' | 'pivot' | ''), stop (true = the price can't be given as is: shown above the total) }.
  const pct = d => `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%`;
  function tireCaveats(r, c) {
    const out = [];
    if (r.price == null) out.push({ cls: 'bad', stop: true, text: 'No price in the sheet for this line. Add it before quoting a total.', say: null });
    if (r.qty < c.q) out.push({ cls: 'bad', stop: true, text: `Only ${r.qty} on hand. Short ${c.q - r.qty} for this quote.`, say: `Only ${r.qty} in stock right now; ${c.q - r.qty} more to order in.` });
    if (r.group === 'alt') {
      const at = (100 * (1 + r.delta / 100)).toFixed(1);
      out.push({ cls: 'pivot', text: `Alternate size, ${pct(r.delta)} diameter. At an indicated 100 km/h the car will be doing ${at} km/h.`,
        say: `Alternate size (${pct(r.delta)} diameter): at an indicated 100 km/h you'll be doing ${at} km/h.` });
    }
    if (r.srWarn) out.push({ cls: 'bad', text: `Speed rating ${r.sr} is below OE ${st.oe.sr}.`, say: `Speed rating ${r.sr} is below the original ${st.oe.sr}.` });
    if (r.used) {
      const what = `Used tire${r.tread != null ? `, ${r.tread}/32″ tread` : ''}${r.dot ? `, DOT ${r.dot}` : ''}`;
      out.push({ cls: '', text: `${what}. Inspect before quoting firm.`, say: `${what}. Price is final after inspection.` });
    }
    if (c.q === 2) out.push({ cls: '', text: 'Pairs go on the rear axle.', say: 'A pair goes on the rear axle.' });
    return out;
  }
  function wheelCaveats(w, c) {
    const v = st.veh.v, out = [];
    if (w.price == null) out.push({ cls: 'bad', stop: true, text: 'No price in the sheet for this line. Add it before quoting a total.', say: null });
    if (w.qty < c.q) out.push({ cls: 'bad', stop: true, text: `Only ${w.qty} on hand. Short ${c.q - w.qty} for this quote.`, say: `Only ${w.qty} in stock right now; ${c.q - w.qty} more to order in.` });
    if (w.lug) out.push({ cls: 'bad', text: `${v.make} OE lug nuts are ${SEAT[v.seat]}. These wheels need ${SEAT[w.seat]} seat${v.lug ? ', ' + v.lug : ''}. Lug set added.`,
      say: `These wheels need ${w.seat}-seat lug nuts; a set is included.` });
    if (w.ring) out.push({ cls: '', text: `Bore ${w.cb} mm on a ${v.cb} mm hub. Hub-centric rings ${w.cb}→${v.cb} are on the quote.`, say: null });
    if (w.unknown.length) out.push({ cls: 'bad', text: `The sheet has no ${w.unknown.join(', ')} for this wheel. Measure before quoting.`,
      say: `Final after we measure the ${w.unknown.join(', ')}.` });
    if (w.minus) out.push({ cls: 'pivot', text: `Minus-size ${w.d}″ wheel. Test-fit over the brake calipers before mounting.`, say: `Minus-size ${w.d}″ wheel: needs a test-fit over the brakes.` });
    if (w.plus) out.push({ cls: 'pivot', text: `Plus-size ${w.d}″ wheel. Needs a lower-profile tire to keep overall diameter.`, say: `Plus-size ${w.d}″ wheel: needs lower-profile tires.` });
    if (w.etWarn) out.push({ cls: 'pivot', text: `Offset ${w.et} vs OE ${w.ref.et} (${sgn(w.dEt)} mm). Check strut and fender clearance.`,
      say: `Offset differs from the original by ${sgn(w.dEt)} mm; clearance to check.` });
    if (w.grade === 'C') out.push({ cls: '', text: `${GRADE.C}. Show the customer before they commit.`, say: `${GRADE.C}.` });
    return out;
  }
  const priced = x => x.price != null;
  const noteCount = (x, cav) => cav.filter(k => k.say).length + (priced(x) ? 0 : 1);
  function priceSentence(x, c, includes) {
    return priced(x) ? `${money(c.total)} out the door, ${includes}.`
      : 'Price needed: this line has no price in the sheet yet, so there is no out-the-door total.';
  }
  const withNotes = (head, x, c, includes, cav) => {
    const says = cav.map(k => k.say).filter(Boolean);
    return `${head} ${priceSentence(x, c, includes)}${says.length ? ' Note: ' + says.join(' ') : ''}`;
  };
  function quoteText(r, c, cav) {
    const head = `${vehLabel()}${r.brand} ${r.model} ${r.size} ${q2(r.li)}${r.sr ?? ''}${r.used ? ` (used${r.tread != null ? `, ${r.tread}/32"` : ''})` : ''} x${c.q}.`;
    return withNotes(head, r, c, `includes mount & balance, disposal${fees.tpmsOn ? ', TPMS kit' : ''} and ${fees.tax}% HST`, cav);
  }
  function quoteTextW(w, c, cav) {
    const extras = [w.ring && 'hub rings', w.lug && 'lug nuts', st.sensors && 'TPMS sensors'].filter(Boolean);
    const head = `${vehLabel()}${w.desc} ${wsize(w)} ET${q2(w.et)} ${st.veh.v.bolt}${w.used ? ` (used${w.grade ? ', grade ' + w.grade : ''})` : ' (new)'} x${c.q}.`;
    return withNotes(head, w, c, `${extras.length ? 'includes ' + extras.join(', ') + ' and ' : 'includes '}${fees.tax}% HST`, cav);
  }
  const cavHtml = list => list.map(k => `<div${k.cls ? ` class="${k.cls}"` : ''}>${esc(k.text)}</div>`).join('');
  const stopsBox = cav => { const s = cav.filter(k => k.stop); return s.length ? `<div class="stops">${cavHtml(s)}</div>` : ''; };
  const copyBtn = n => `<button class="primary" id="copy">Copy quote${n ? `<span class="ncav">+ ${n} note${n === 1 ? '' : 's'}</span>` : ''} <kbd>C</kbd></button>
      <div class="copied" id="copied" role="status"></div>`;
  const qtyRow = () => `<div class="qtyrow" role="group" aria-label="Quantity">${[1, 2, 3, 4].map(n => `<button data-qty="${n}" aria-pressed="${st.qty === n}">${n}<kbd>${n}</kbd></button>`).join('')}</div>`;
  const pullBox = (loc, qty) => `<div class="pull"><div><small>Pull from</small><span class="bin">${esc(loc || '—')}</span></div><div class="onhand"><small>On hand</small><b>${qty}</b></div></div>`;
  const band = (what, forWhat = '') => `<div class="ticket"><span>${what}</span>${forWhat ? `<span>${forWhat}</span>` : ''}</div>`;
  // No price: no total. A number that leaves the tires out must never sit in the total's place.
  const totalBox = (x, c, unit) => priced(x)
    ? `<div><div class="total"><span class="lbl">Out the door</span><span class="amt">${money(c.total)}</span></div><div class="per">${money(c.total / c.q)} per ${unit}</div></div>`
    : `<div><div class="total"><span class="lbl">Out the door</span><span class="amt none">Price needed</span></div><div class="per">Fees and HST come to ${money(c.total)} without the ${unit.split(' ')[0]}s.</div></div>`;
  // Total and Copy stay pinned to the bottom of the quote pane (CSS sticky), so a short counter screen never scrolls them
  // away. Caveats that block the price ride with the total; the rest sit above it, read before the number.
  const dock = (x, c, unit, cav) => `<div class="qdock">${stopsBox(cav)}${totalBox(x, c, unit)}${copyBtn(noteCount(x, cav))}</div>`;
  function renderQuote() { st.tab === 'tires' ? renderTireQuote() : renderWheelQuote(); }
  function renderTireQuote() {
    const el = $('quote'), r = selected();
    if (!r) { el.innerHTML = `${band('Out-the-door quote')}<div class="gen">Pick a tire to price it installed.</div>`; return; }
    const c = calc(r), cav = tireCaveats(r, c), rest = cav.filter(k => !k.stop);
    el.innerHTML = `
      ${band('Tire quote', st.mode === 'vehicle' ? st.veh.year + ' ' + esc(st.veh.v.model) : st.target ? st.target.key : '')}
      <div class="qhead"><div class="tire">${esc(r.brand)} ${esc(r.model)}</div>
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
      ${rest.length ? `<div class="warns">${cavHtml(rest)}</div>` : ''}
      ${dock(r, c, 'tire installed', cav)}`;
  }
  function renderWheelQuote() {
    const el = $('quote'), w = selectedW();
    if (!w) { el.innerHTML = `${band('Wheel quote')}<div class="gen">${st.mode === 'vehicle' ? 'Pick a wheel to price it.' : 'Search a vehicle to match wheels.'}</div>`; return; }
    if (st.mode !== 'vehicle') {   // browsing: fit, rings and lug nuts all depend on the car
      el.innerHTML = `${band('Wheel quote')}<div class="qhead"><div class="tire">${esc(w.desc)}</div>
        <div class="spec">${wsize(w)} ET${q2(w.et)} · ${esc(w.pcd)} · CB ${q2(w.cb)} · ${money(w.price)} each · ${w.qty} on hand</div></div>
        <div class="gen">Add the customer's vehicle to check fit and price it with any rings or lug nuts it needs.</div>`;
      return;
    }
    const v = st.veh.v, c = calcW(w), cav = wheelCaveats(w, c), rest = cav.filter(k => !k.stop);
    const tireLine = w.tire ? `Takes <b class="mono">${w.tire.key}</b>${w.tire.delta ? ` (${w.tire.delta > 0 ? '+' : '−'}${Math.abs(w.tire.delta).toFixed(1)}% vs OE)` : ''}` : `No ${w.d}″ tire in stock within ±${fees.tol}% of OE diameter. Special order.`;
    const oeIdx = v.oe.findIndex(o => parseSize(o[0]).r === w.d);
    el.innerHTML = `
      ${band('Wheel quote', st.veh.year + ' ' + esc(v.model))}
      <div class="qhead"><div class="tire">${esc(w.desc)}</div>
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
      <div class="warns"><div>${tireLine}</div>${cavHtml(rest)}</div>
      ${oeIdx >= 0 && visible().length ? `<button class="ghost" id="toTires" data-oeidx="${oeIdx}">Show ${v.oe[oeIdx][0]} tires for this wheel</button>` : ''}
      ${dock(w, c, 'wheel', cav)}`;
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
  /** `flash`: set from the keyboard, so the change is shown (a stray digit should never pass unnoticed). */
  function setQty(n, flash = false) {
    st.qty = n; renderQuote();
    const b = flash && document.querySelector(`.qtyrow button[data-qty="${n}"]`); if (b) b.classList.add('flash');
  }
  function copyQuote() {
    let txt, n;
    if (st.tab === 'wheels') { const w = selectedW(); if (!w || st.mode !== 'vehicle') return; const c = calcW(w), cav = wheelCaveats(w, c); txt = quoteTextW(w, c, cav); n = noteCount(w, cav); }
    else { const r = selected(); if (!r) return; const c = calc(r), cav = tireCaveats(r, c); txt = quoteText(r, c, cav); n = noteCount(r, cav); }
    flush();
    const out = $('copied');
    const fallback = () => { out.innerHTML = `<textarea id="fallback" rows="4" readonly>${esc(txt)}</textarea>`; const ta = $('fallback'); ta.focus(); ta.select(); };
    const done = n ? `Copied with ${n} note${n === 1 ? '' : 's'}. Read the notes out too.` : 'Copied. Paste into a text or read it out.';
    try { navigator.clipboard.writeText(txt).then(() => { out.textContent = done; }).catch(fallback); } catch (e) { fallback(); }
  }
  function saveFees() { try { localStorage.setItem('gct-fees', JSON.stringify(fees)); } catch (e) {} }

  on(document, 'click', e => {
    const ord = e.target.closest('a[data-order]');
    if (ord) { copyForOrder(ord.dataset.order, ord.dataset.filled === 'true'); return; }
    if (e.target.closest('#clearAll')) { newCustomer(); return; }
    const b = e.target.closest('[data-y],[data-pick],#lookupGo,#lookupNo,#lookupSize,[data-s],[data-oe],[data-tab],[data-season],[data-cond],[data-wtype],[data-wcond],[data-qty],tr.wrow,tr.row,#copy,#copySize,#toTires'); if (!b) return;
    if (b.dataset.y) setVehicle(+b.dataset.y, b.dataset.mk, b.dataset.md);
    else if (b.dataset.pick) { pendingPick = +b.dataset.pick; renderPopup(); }
    else if (b.id === 'lookupGo') confirmLookup();
    else if (b.id === 'lookupNo') cancelLookup();
    else if (b.id === 'lookupSize') sizeInstead();
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

  for (const id of VBOX) {
    on($(id), 'input', () => { lastBox = id; if (id === 'qmk') fillModelList(); searchVehicle(false); });
    on($(id), 'focus', () => setActive(id));
  }
  // Year box jumps to Make once the year is complete: four digits, or two that can't be the start of one ("18", not "20").
  on($('qv'), 'input', e => {
    const v = e.target.value;
    if (e.inputType !== 'deleteContentBackward' && (/^\d{4}$/.test(v) || (/^\d{2}$/.test(v) && !/^(19|20)$/.test(v)))) $('qmk').focus();
  });
  on($('qs'), 'input', e => searchSize(e.target.value));
  const focusBox = id => { const el = $(id); el.focus(); el.select(); };
  // Digits typed outside the boxes. A lone 1-4 sets the quantity. A second digit right after it means someone is typing
  // the next year or size: the quantity goes back and the digits go into the box they last searched in.
  let typed = null;
  function startTyping(text) {
    const id = lastBox === 'qs' ? 'qs' : 'qv', el = $(id);
    clearBox(id); el.value = text; el.focus(); el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  on(document, 'keydown', e => {
    if (pending && e.key === 'Escape') { e.preventDefault(); cancelLookup(); return; }
    if (pending && e.key === 'Enter' && !e.target.matches('textarea')) {
      e.preventDefault();
      if (!popupHasFocus()) { focusPopup(); return; }     // first Enter: onto the popup, nothing spent
      if (e.repeat || Date.now() < armedAt) return;       // a held or doubled Enter never spends
      if (blocked(pending) || e.target.id === 'lookupSize') sizeInstead();
      else if (e.target.id === 'lookupNo') cancelLookup();
      else if (e.target.dataset.pick) pickModel(+e.target.dataset.pick);
      else confirmLookup();
      return;
    }
    if (pending && popupHasFocus() && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      e.preventDefault(); pickModel(pendingPick + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1)); return;
    }
    if (isVBox(e.target.id) || e.target.id === 'qs') {
      const vbox = isVBox(e.target.id);
      // Enter in a vehicle box before the vehicle has resolved: complete the model and look it up.
      if (vbox && e.key === 'Enter' && st.mode !== 'vehicle') { e.preventDefault(); searchVehicle(true); return; }
      if ((e.key === 'ArrowDown' && !vbox) || e.key === 'Enter') { e.preventDefault(); flush(); if (!st.sel) autoSelect(); $('tablewrap').focus({ preventScroll: true }); render(); }
      else if (e.key === 'Escape') { e.target.select(); }
      return;
    }
    if (e.target.matches('input,textarea,select')) return;
    const k = e.key.toLowerCase();
    if (/^\d$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const now = Date.now();
      if (typed && now - typed.at < 400) { st.qty = typed.prevQty; renderQuote(); const d = typed.digits + e.key; typed = null; startTyping(d); }
      else if (/^[1-4]$/.test(e.key) && !pending) { typed = { digits: e.key, prevQty: st.qty, at: now }; setQty(+e.key, true); }
      else { typed = null; if (pending) cancelLookup(); startTyping(e.key); }
      return;
    }
    typed = null;
    if (k === 'v' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); focusBox('qv'); }
    else if (k === 's' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (pending) sizeInstead(); else focusBox('qs'); }
    else if (e.key === '/' || ((e.metaKey || e.ctrlKey) && k === 'k')) { e.preventDefault(); focusBox(lastBox); }
    else if (k === 't' && !e.metaKey && !e.ctrlKey) setTab('tires');
    else if (k === 'w' && !e.metaKey && !e.ctrlKey) setTab('wheels');
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if ((e.key === '[' || e.key === ']') && st.mode === 'vehicle') setOE(st.oeIdx + (e.key === ']' ? 1 : -1));
    else if (k === 'c' && !e.metaKey && !e.ctrlKey) copyQuote();
    else if (k === 'n' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); newCustomer(); }
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
  $('status').innerHTML = `<span class="dot${data.mode === 'live' ? ' live' : ''}"></span>${esc(data.status)} · <a href="/sync">sync</a> · <a href="/import">import</a> · <a href="/setup">setup</a>`;
  $('triesV').innerHTML = 'Try: ' + data.tries.vehicles.map(v => `<button data-y="${v.year}" data-mk="${esc(v.make)}" data-md="${esc(v.model)}">${esc(v.label)}</button>`).join('');
  $('triesS').innerHTML = 'Try: ' + data.tries.sizes.map(s => `<button data-s="${esc(s)}">${esc(s)}</button>`).join('');

  // Starts empty, showing the whole inventory (and a page load never spends a Wheel-Size hit).
  // Make/model suggestions. Until they load, boxes still work: the server matches what was typed.
  compute(); render(); $('qv').focus();
  api.catalog().then(c => {
    catalog = c;
    $('dlMake').innerHTML = c.map(m => `<option value="${esc(m.name)}"></option>`).join('');
    fillModelList();
    // Demo starts in a realistic working state. Live starts empty so a page load never touches Wheel-Size.
  }).catch(() => {});

  return () => { ac.abort(); clearTimeout(vtimer); };
}
