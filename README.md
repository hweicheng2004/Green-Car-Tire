# Green Car Tires counter: server code

See `PLAN.md` for how the pieces fit and the build order.

## Wheel-Size connection

Server-side link between the counter dashboard and the Wheel-Size Fitment API (v2), with a Supabase cache so each vehicle-year costs two API hits (Canadian + US data) the first time and none after.

```
Counter box "18 outback"
  → GET /api/vehicles?q=18 outback        local table, 0 hits   → subaru / outback / 2018
  → GET /api/fitment?make=subaru&model=outback&year=2018
       Supabase vehicle_fitment hit?  → return it (0 hits)
       miss → Wheel-Size /v2/search/by_model/ for cdm, then usdm (2 hits) → merge → normalize → cache → return
```

## Setup

1. **Get a key.** Sign up at developer.wheel-size.com. The free sandbox key gives 300 hits/day for testing. Keys are hand-reviewed (a few hours).
2. **Env.** Copy `.env.example` to `.env.local` (Next.js) and `.env` (scripts), and fill in the key and Supabase values.
3. **Check the key** (2 hits): `npm i && npm run check-key -- 2018 subaru outback`
   It prints the fitment card and saves the raw JSON. Compare the bolt pattern, bore, sizes and offsets to what you know about the car. If any field comes out `?`, send that JSON file back and the mapping in `lib/fitment.ts` gets adjusted.
4. **Database.** Run `supabase/migrations/001_wheelsize_cache.sql`, `002_search_log.sql` and `003_inventory.sql`, in order, in the Supabase SQL editor.
5. **Load makes and models** (about 120 hits for both markets, once a year; run it on a quiet day): `npm run seed-models`
6. **Copy into the Next.js app:** `lib/*` and `app/api/*` go into the app as-is (the `@/` import alias is assumed).

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
- **Your stock.** Inventory still comes from the Google Sheets sync. The dashboard joins the fitment card to inventory by tire size, bolt pattern and bore.

## Plan sizing

The cache is what keeps you on a small plan. Each new vehicle-year costs 2 hits, then 0 for 180 days. 300 hits/day covers about 150 never-seen vehicles a day, and repeat vehicles are free, so the cache warms up within a few weeks. If the limit is reached, cached vehicles keep working and new ones show "check the door placard". Wheel-Size's pricing page lists the free sandbox as testing and development only; Basic ($450/yr, 5,000/day) is their production plan. Set `WHEELSIZE_DAILY_LIMIT` to match your plan.
