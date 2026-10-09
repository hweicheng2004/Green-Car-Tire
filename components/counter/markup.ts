// Static markup of the counter screen, from the clickable prototype. counter.js fills the panes.
export const COUNTER_MARKUP = `  <header class="bar">
    <div class="brand"><span class="mark">GCT</span>Green Car Tires<span class="sub">Counter</span></div>
    <div class="status" id="status"><span class="dot"></span>Loading inventory…</div>
  </header>

  <section>
    <div class="omnis">
      <div class="field">
        <label for="qv" class="flabel">Year · make · model</label>
        <div class="omni veh3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 17h14M6 17l1.5-5h9L18 17M7.5 12 9 8h6l1.5 4"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/></svg>
          <input id="qv" class="vy" autocomplete="off" spellcheck="false" inputmode="numeric" maxlength="4" placeholder="Year" aria-label="Year">
          <input id="qmk" class="vmk" autocomplete="off" spellcheck="false" placeholder="Make" aria-label="Make" list="dlMake">
          <input id="qmd" class="vmd" autocomplete="off" spellcheck="false" placeholder="Model" aria-label="Model" list="dlModel">
          <span class="parse none" id="parseV">—</span>
          <kbd>V</kbd>
        </div>
        <datalist id="dlMake"></datalist><datalist id="dlModel"></datalist>
        <div class="lookup-pop" id="lookupPop" role="dialog" aria-live="polite" hidden></div>
        <div class="tries" id="triesV"></div>
      </div>
      <div class="field">
        <label for="qs" class="flabel">Tire size</label>
        <div class="omni">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>
          <input id="qs" autocomplete="off" spellcheck="false" inputmode="numeric" placeholder="225 65 17">
          <span class="parse none" id="parseS">—</span>
          <kbd>S</kbd>
        </div>
        <div class="tries" id="triesS"></div>
      </div>
    </div>
  </section>

  <main class="panes">
    <aside class="pane fit" id="fit" aria-label="Fitment"></aside>
    <section class="pane" aria-label="Stock on hand">
      <div class="stockhead">
        <div class="tabs" role="tablist" id="tabs"></div>
        <div id="banner"></div>
        <div id="special"></div>
        <div class="filters" id="filters"></div>
      </div>
      <div class="tablewrap" id="tablewrap" tabindex="0">
        <table id="ttable">
          <thead><tr><th>Size</th><th>Tire</th><th>Type</th><th>Cond.</th><th>Load/Speed</th><th>DOT</th><th class="r">Qty</th><th class="r">Unit</th><th>Location</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
        <table id="wtable" hidden>
          <thead><tr><th>Size · offset</th><th>Wheel</th><th>Type</th><th>Cond.</th><th>Bore</th><th>Fit notes</th><th class="r">Qty</th><th class="r">Unit</th><th>Location</th></tr></thead>
          <tbody id="wrows"></tbody>
        </table>
      </div>
      <div id="excl"></div>
    </section>
    <aside class="pane quote" aria-label="Out-the-door quote">
      <div id="quote" style="display:flex;flex-direction:column;gap:14px"></div>
      <details class="fees">
        <summary>Shop fees &amp; rules</summary>
        <div class="feegrid">
          <label for="f-mount">Mount &amp; balance / tire</label><input type="number" id="f-mount" step="0.5" min="0">
          <label for="f-disp">Disposal / tire</label><input type="number" id="f-disp" step="0.5" min="0">
          <label for="f-tpmsOn"><input type="checkbox" id="f-tpmsOn"> TPMS service kit / tire</label><input type="number" id="f-tpms" step="0.5" min="0" aria-label="TPMS service kit price">
          <label for="f-rings">Hub rings / set of 4</label><input type="number" id="f-rings" step="0.5" min="0">
          <label for="f-lugs">Lug nut set</label><input type="number" id="f-lugs" step="0.5" min="0">
          <label for="f-sensor">TPMS sensor / wheel</label><input type="number" id="f-sensor" step="0.5" min="0">
          <label for="f-tax">HST %</label><input type="number" id="f-tax" step="0.5" min="0">
          <label for="f-tol">Alternate diameter ± %</label><input type="number" id="f-tol" step="0.5" min="0.5" max="5">
          <label for="f-et">Wheel offset ± mm (still a fit)</label><input type="number" id="f-et" step="1" min="0" max="30">
          <div class="feehint">TireConnect: open it, search 225/65R17, copy the address bar and paste it here. The counter swaps in each size. If the address has no size in it, the button opens TireConnect and copies the size to paste.</div>
          <div class="distrow"><label for="f-tc" style="font-weight:600">TireConnect</label><input id="f-tc" placeholder="Paste a TireConnect search address" aria-label="TireConnect search address"></div>
          <div class="feehint" id="f-tc-status"></div>
          <div class="feehint">Other distributors for special orders. Paste a search address for 225/65R17 the same way.</div>
          <div class="distrow"><input id="dn0" placeholder="Name" aria-label="Distributor 1 name"><input id="du0" placeholder="https://portal.example.com/search?q={size}" aria-label="Distributor 1 search URL"></div>
          <div class="distrow"><input id="dn1" placeholder="Name" aria-label="Distributor 2 name"><input id="du1" placeholder="https://…{raw}" aria-label="Distributor 2 search URL"></div>
          <div class="distrow"><input id="dn2" placeholder="Name" aria-label="Distributor 3 name"><input id="du2" placeholder="https://…" aria-label="Distributor 3 search URL"></div>
        </div>
      </details>
    </aside>
  </main>

  <footer class="keys">
    <span><kbd>V</kbd> vehicle box</span><span><kbd>S</kbd> size box</span><span><kbd>↵</kbd> to results</span><span><kbd>↑</kbd><kbd>↓</kbd> pick tire</span>
    <span><kbd>1</kbd>–<kbd>4</kbd> quantity</span><span><kbd>T</kbd>/<kbd>W</kbd> tires or wheels</span><span><kbd>[</kbd><kbd>]</kbd> OE size</span><span><kbd>C</kbd> copy quote</span><span><kbd>O</kbd> order on TireConnect</span><span><kbd>Esc</kbd> back to search</span>
  </footer>
`;
