# Green Car Tires counter: server code

See `PLAN.md` for how the pieces fit and the build order.

## Wheel-Size connection

Server-side link between the counter dashboard and the Wheel-Size Fitment API (v2), with a Supabase cache so each vehicle-year costs two API hits (Canadian + US data) the first time and none after.

```
Counter boxes  Year 2018 · Make Subaru · Model Outback   (make/model suggest from vehicle_models; 0 hits)
  → GET /api/counter/vehicle?year=2018&make=subaru&model=outback
       saved in Supabase vehicle_fitment?  → show it (0 hits)
       not saved → { needsLookup } → popup: "2018 Subaru Outback isn't saved yet. Look it up? Uses 2 lookups (N left today)"
  → confirmed (Enter / Look it up) → same URL + &lookup=1
       Wheel-Size /v2/search/by_model/ for cdm and usdm in parallel (2 hits) → merge → normalize → save → show
```

The counter never calls Wheel-Size on its own: nothing is spent while someone is typing, or on a wrong model.
A confirmed lookup must name an exact model from the vehicle list, so the URL can't be used to spend lookups on
arbitrary vehicles. `GET /api/fitment` (not used by the counter) still looks up directly, for scripts.

## First use (`/setup`)

Once demo mode is off (Supabase connected, `DEMO_MODE` removed or `0`), the counter sends you to `/setup` until stock is loaded:

1. **Database connected**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
2. **Tables**: Copy setup SQL (the same as `supabase/setup-all.sql`), paste it in Supabase > SQL Editor, Run, then Check again.
3. **Tires** and 4. **Wheels**: choose a CSV or Excel file. The server cleans it with the same cleaner as the Sheets sync, shows what will load and which rows won't, then loads it in one go (replacing that table). No SQL to copy.
5. **Optional**: Google Sheets sync, Wheel-Size key, Claude key, admin password. With the Wheel-Size key set, **Load the make/model list** fills the vehicle boxes' suggestions (about 120 lookups, once; same as `npm run seed-models`). Vehicles missing from the list can still be looked up: press Enter in the model box and confirm.

To try it with made-up stock, download `/samples/demo-tires.csv` and `/samples/demo-wheels.csv` from the site (links on `/setup`). They include a few bad rows on purpose. Set `ADMIN_PASSWORD` before the site is public: loading stock asks for it.

## Demo (no accounts)

Deploy to Vercel with no environment variables, or run `npm run dev` locally without a `.env.local`. With no `SUPABASE_URL` the app runs in demo mode:

- `/` is the counter screen (the clickable prototype, now in the app) on sample stock from `demo/demo-inventory.json`, the same cells as the demo Google Sheet, run through the real sheet cleaner. Vehicle fitment is a small built-in sample list (Outback, RAV4, CR-V, Civic, Corolla, F-150, CX-5, Escape).
- `/sync` shows what a sync of the demo sheet produces, including the "Sync issues" tab.
- Nothing is saved and no API is called. Set `DEMO_MODE=0` to force live mode, `DEMO_MODE=1` to force demo with accounts set.

## Spreadsheet import with Claude (`/import`)

Upload a CSV or Excel file (or paste cells) and get SQL to run in Supabase.

1. The same rule-based cleaner as the Sheets sync reads every row in the browser. Free and instant; most rows end here.
2. **Fix with Claude** sends only the rows the rules couldn't read (or the whole sheet if its columns weren't recognised, or every row if you tick the box) to `claude-opus-5-5`, 60 rows per request, a few requests in parallel. The instructions are prompt-cached, so later batches cost less.
3. Claude returns structured rows (a JSON schema), not SQL. Each row is checked against the same limits as the database (`lib/claude-import.ts`), and `toSql()` writes the SQL. A wrong answer can only reject a row.

The page shows each row's origin (rules or Claude), what Claude changed, and an estimated cost. Needs `ANTHROPIC_API_KEY`; set `ADMIN_PASSWORD` so a public URL can't spend your credit. Requests use `fallbacks: "default"`, so a request Claude declines is re-run on Anthropic's recommended fallback model instead of failing.

## Special orders: TireConnect

When a size has no new tire in stock, the counter shows **Order on TireConnect** (or press **O**). It opens TireConnect searched for that size and copies the size too.

Set it up once: open TireConnect, search **225/65R17**, copy the address bar, and paste it either
- for every counter PC: Vercel env `TIRECONNECT_URL`, or in Supabase `insert into shop_settings (key, value) values ('tireconnect', '{"url": "PASTE HERE"}') on conflict (key) do update set value = excluded.value;`
- or for one PC: Shop fees & rules > TireConnect.

The counter finds 225, 65 and 17 in the address and swaps in each size (`components/counter/order-link.ts`). If TireConnect's address doesn't include the size, the button still opens it and the size is on the clipboard to paste. Other distributor portals work the same way.

## Setup

1. **Get a key.** Sign up at developer.wheel-size.com. The free sandbox key gives 300 hits/day for testing. Keys are hand-reviewed (a few hours).
2. **Env.** Copy `.env.example` to `.env.local` (Next.js) and `.env` (scripts), and fill in the key and Supabase values.
3. **Check the key** (2 hits): `npm i && npm run check-key -- 2018 subaru outback`
   It prints the fitment card and saves the raw JSON. Compare the bolt pattern, bore, sizes and offsets to what you know about the car. If any field comes out `?`, send that JSON file back and the mapping in `lib/fitment.ts` gets adjusted.
4. **Database.** In Supabase, open SQL Editor > New query, paste all of `supabase/setup-all.sql` (migrations 001 to 004 in one file) and press Run. Safe to run again. After changing a migration, `npm run setup-sql` rebuilds it.
5. **Load makes and models** (about 120 hits for both markets, once a year; run it on a quiet day): `npm run seed-models`
6. **Run the app:** `npm run dev`, then open http://localhost:3000/sync. This repo is the Next.js app; deploy it to Vercel as is.
7. **Sheets sync:** see Phase 2 in `PLAN.md`.

## Files

| File | What it does |
|---|---|
| `lib/wheelsize.ts` | API client. Key stays on the server. |
| `lib/fitment.ts` | Merges Wheel-Size's per-trim records into one card: OE sizes with trims, load/speed, rim width and offset, bolt pattern, bore, lug thread, torque. Keeps factory and optional sizes apart, flags trims that differ in bolt pattern or bore. |
| `lib/vehicle-query.ts` | Parses `18 outback`, `2019 honda civic`, `f150 17`. |
| `app/api/vehicles/route.ts` | Shorthand → make/model slugs from the local table. |
| `app/api/fitment/route.ts` | Cached fitment lookup. Counts daily hits and serves the stale cache instead of failing when the quota or the API is down. |
| `lib/search-log.ts` | Search-log rules: validates a search and classifies the outcome (in stock, used only, alternate only, special order, no match). |
| `lib/log-search-client.ts` | For the dashboard. `logSearch(...)` saves a search once typing settles (1.5 s), `flushSearch()` on Enter, row click or copy quote. Skips repeats, never blocks a quote. |
| `app/api/searches/route.ts` | `POST` saves one search, `GET` lists recent ones. |
| `app/api/fitment/by-size/route.ts` | Vehicles that came on a size ("OE on" for size searches), from saved fitments. No API calls. |
| `lib/inventory-clean.ts` | Cleans spreadsheet rows into tire and wheel rows, finds the header row, matches columns, writes the import SQL. Shared by the importer page and the future Sheets sync. |
| `lib/google-sheets.ts` | Google Sheets client (service account, no extra packages): read tabs, write the "Sync issues" tab. |
| `lib/inventory-sync.ts` | The sync: cleans each tab, decides if it's safe to write, builds the "Sync issues" tab. |
| `lib/inventory-sync-store.ts` | Supabase side of the sync, and the wiring shared by the route and the page. |
| `app/api/sync/sheets/route.ts` | `POST` runs a sync (needs `Authorization: Bearer CRON_SECRET`), `GET` returns the latest sync per kind. |
| `app/sync/page.tsx` | Sync status page with Sync now / Sync anyway buttons. |
| `supabase/migrations/004_inventory_sync.sql` | `inventory_syncs` log and `replace_inventory()` (one transaction per table). |
| `supabase/cron-sync.sql` | 5-minute schedule from Supabase pg_cron. Run once after deploying. |
| `components/counter/` | The counter screen: `markup.ts` (layout), `counter.js` (search, fitment math, quotes, keyboard), `Counter.tsx` (loads data). Styles in `app/globals.css`. |
| `app/api/counter/*` | What the screen calls: `inventory` (stock, fees, status), `vehicle?q=` (shorthand → cached fitment), `size?size=` ("OE on" list). Demo or live. |
| `lib/counter-data.ts` | The screen's data shapes, and mappers from Supabase rows and Wheel-Size fitment. |
| `lib/counter-live.ts` | Live data: Supabase inventory and settings, fitment through the cache. |
| `lib/demo.ts` | Demo mode: sample vehicles, demo sheet inventory, sync preview. |
| `lib/vehicle-lookup.ts`, `lib/fitment-lookup.ts` | Shorthand → model, and the cached Wheel-Size lookup. Shared by the API routes and the counter. |
| `components/import/ImportDashboard.tsx`, `app/import/page.tsx` | The `/import` page. |
| `lib/claude-import.ts`, `app/api/import/claude/route.ts` | Claude reads the rows the rules couldn't: prompt, output schema, validation, batching. |
| `app/setup/page.tsx`, `components/setup/SetupWizard.tsx`, `lib/setup.ts`, `app/api/setup/*` | First-use setup: status checks, loading a spreadsheet straight into Supabase. |
| `public/samples/` | Demo CSVs for testing live mode (built by `demo/build-demo-sheet.py`). |
| `importer/` | The Sheet → SQL page. `node scripts/build-importer.mjs` rebuilds `importer/dist/sheet-import.html` after cleaner changes. |
| `supabase/migrations/003_inventory.sql` | `tires`, `wheels`, `shop_settings` tables. |
| `scripts/seed-models.ts` | Loads all Canadian and US makes and models for the counter search. |
| `scripts/check-key.ts` | Sanity check with your key (2 hits). |

## Why both Canadian and US data

Wheel-Size tags many trims sold in Canada as US-only. For a 2018 Outback, the Canadian query returns only the 3.6R, so the 2.5i and its 225/65R17 size are missing. Querying `cdm` then `usdm` and merging by trim fixes that. Canadian and US fitment (bolt pattern, bore, sizes) is the same for nearly every car. Set `WHEELSIZE_REGIONS=cdm` to turn the merge off.

`test/outback.test.ts` runs the normalizer against the real 2018 Outback responses: `npm test`.

## What gets saved on every search

| Table | Written when | Used for |
|---|---|---|
| `vehicle_fitment` | first lookup of a vehicle-year (and after 180 days) | the fitment card, without spending API calls |
| `fitment_oe_sizes` | every time a fitment is saved | "which vehicles use 225/65R17?" for size searches |
| `counter_searches` | every settled search, vehicle or size | what was asked, what was shown, whether you had it |

Two reports are ready in Supabase:
- `missed_demand_30d`: sizes asked for in the last 30 days with no new tire on the shelf. Use it to decide what to stock.
- `top_vehicles_30d`: most-searched vehicles, for wheel and winter-package stocking.

`npm test` runs both migrations in an embedded Postgres and checks the save, backfill, outcome and report logic.

## Things Wheel-Size doesn't cover

- **Lug seat type** (conical, ball or flat). Defaulted by make in `lib/fitment.ts` (Honda/Acura ball, Toyota/Lexus flat, most others conical). Set `vehicle_fitment.lug_seat` to override a vehicle.
- **Your stock.** Inventory comes from the Google Sheets sync (`/api/sync/sheets`). The dashboard joins the fitment card to inventory by tire size, bolt pattern and bore.

## Plan sizing

The cache is what keeps you on a small plan. Each new vehicle-year costs 2 hits, then 0 for 180 days. 300 hits/day covers about 150 never-seen vehicles a day, and repeat vehicles are free, so the cache warms up within a few weeks. If the limit is reached, cached vehicles keep working and new ones show "check the door placard". Wheel-Size's pricing page lists the free sandbox as testing and development only; Basic ($450/yr, 5,000/day) is their production plan. Set `WHEELSIZE_DAILY_LIMIT` to match your plan.
