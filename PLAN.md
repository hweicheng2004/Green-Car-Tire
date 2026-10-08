# Green Car Tires counter: from prototype to working app

## How the pieces fit

```
 Staff edit inventory             Counter tech types "18 outback" or "225 65 17"
 in Google Sheets                             │
        │                                     ▼
        │ every 5 min (pg_cron)   ┌───────────────────────────┐
        ▼                         │  Counter app (Next.js,    │
 Sheets sync route  ───────────▶  │  hosted on Vercel)        │
 (same cleaner as the importer)   │  the prototype screen,    │
        │                         │  wired to real data       │
        ▼                         └─────┬──────────┬──────────┘
 ┌──────────────────────────┐           │          │
 │ Supabase (Postgres)      │ ◀─────────┘          │ new vehicle only
 │  tires, wheels           │  inventory,          ▼
 │  vehicle_fitment (cache) │  fitment,      Wheel-Size API
 │  counter_searches (log)  │  search log    (2 calls per new vehicle-year)
 │  shop_settings (fees)    │
 └────────────┬─────────────┘
              ▼
   Reports: missed_demand_30d, top_vehicles_30d (Looker Studio later if wanted)
```

The sheet stays the place staff change stock. Supabase is a fast, clean copy the counter reads. Wheel-Size fills in vehicle specs once per vehicle, then the cache answers.

## Built and tested so far

| Piece | State |
|---|---|
| Counter screen (prototype) | Clickable, sample data. Tires, wheels, OTD quote, special-order links. |
| Wheel-Size client + fitment cache | Done. Tested against real 2018 Outback data. Queries Canada + US and merges. |
| Search log + reports | Done. Tested in Postgres. |
| Inventory tables (`003_inventory.sql`) | Done. Tested in Postgres. |
| Sheet cleaner (`lib/inventory-clean.ts`) | Done. Handles messy sizes, load/speed, tread, DOT, season words, set prices, inch bolt patterns, dual-drilled wheels. |
| Sheet → SQL importer page | Done. Paste or upload, check columns, review flagged rows, copy SQL. |
| Automatic Sheets sync | Built and tested (fake Google, real Postgres). Needs your Google service account to go live. |
| Demo mode | No accounts needed. Deploy with no env vars to show the counter and `/sync` on the demo sheet. |
| Counter app wired to real data | Built: the prototype screen is the app's home page, fed by `/api/counter/*`. Runs on demo data with no accounts; switches to Supabase + Wheel-Size when `SUPABASE_URL` is set. Live mode is untested against real accounts. |

## Build order

**Phase 0: accounts (half a day).** Supabase project, GitHub repo, Vercel account, Google Cloud service account for Sheets. Paste `supabase/setup-all.sql` into the Supabase SQL editor and run it (migrations 001 to 004 in one go). Run `npm run seed-models` once.

**Phase 1: inventory into the database (1 to 2 days).** Put tires on one tab and wheels on another, each with one header row. Paste each tab into the importer, fix what it flags in the sheet, re-paste until rejected is zero, run the SQL. Done when the counter's sample sizes can be answered from Supabase.

**Phase 2: automatic sync (code done; setup about an hour).** `POST /api/sync/sheets` reads the tabs with the service account, runs the same cleaner, and replaces each table in one transaction (`replace_inventory`, migration 004). Rejected rows go to a "Sync issues" tab in the sheet. It runs every 5 minutes from Supabase pg_cron (`supabase/cron-sync.sql`), because Vercel's free plan only allows a cron once a day. `/sync` has a Sync now button. Safety: an unchanged sheet costs no database writes; a missing tab, a renamed size column, or a drop of more than half the rows is blocked and the counter keeps the last good data until someone fixes it or presses "Sync anyway". Done when a qty changed in the sheet shows at the counter within 5 minutes.

Setup steps (to demo first, use `demo/demo-inventory.xlsx`: upload it to Google Drive, which turns it into a Google Sheet with Tires and Wheels tabs of made-up stock and 3 deliberately bad rows. `python3 demo/build-demo-sheet.py` rebuilds it):
1. Google Cloud: create a project, enable the Google Sheets API, create a service account, add a JSON key.
2. Share the inventory sheet with the service account's email as **Editor** (it writes the "Sync issues" tab).
3. Run `supabase/setup-all.sql` in Supabase if you haven't (it includes migration 004).
4. Set the env vars in `.env.example` (Sheets section) in Vercel, deploy.
5. Open `/sync`, press Sync now, read the "Sync issues" tab, fix rows in the sheet.
6. Run `supabase/cron-sync.sql` (with your URL and CRON_SECRET filled in) for the 5-minute schedule.

**Phase 3: counter app on real data (mostly built).** The prototype screen is the home page. It loads all stock once from `/api/counter/inventory` (a few hundred rows; filtering stays instant), resolves vehicles through `/api/counter/vehicle` (local model table, then the fitment cache, Wheel-Size only for a new vehicle-year), and logs settled searches to `counter_searches`. Fees and distributor links come from `shop_settings`; edits in the fee panel are kept per counter PC. Left to do once accounts exist: run it against real stock and fitment. Done when the prototype's test searches give the same answers on real stock.

**Phase 4: lock it down (1 day).** Staff sign in (Supabase Auth, or Vercel password protection for a single shared counter login). Keys stay in server env only.

**Phase 5: go live (1 week side by side).** Use the counter beside the sheet. Compare a day's quotes. Check `missed_demand_30d` at the end of the week.

**Later:** a "Sold" button that lowers qty and writes back to the sheet; tire-and-wheel winter package quotes; Looker Studio reports.

## Decisions needed from the shop

1. **Sheet layout.** Is it one tab for tires and one for wheels today? The sync expects tabs named "Tires" and "Wheels" (change with `SHEETS_TIRE_TABS` / `SHEETS_WHEEL_TABS`; several tabs per kind are fine). A copy or CSV export lets the importer be tuned to your real columns.
2. **Who lowers qty after a sale.** Staff in the sheet (simplest, works from day one) or a counter "Sold" button (needs write-back to the sheet).
3. **Logins.** One shared counter login, or one per person (lets the search log show who quoted what).
4. **Wheel-Size plan.** The free key is listed as testing only; Basic is $450/yr for production use.
5. **Hosting.** Vercel's free tier fits a single shop (the 5-minute sync runs from Supabase, so no paid Vercel plan is needed). Pick a domain if you want one (e.g. counter.greencartires.ca).
