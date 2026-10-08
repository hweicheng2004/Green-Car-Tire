# Green Car Tires counter: from prototype to working app

## How the pieces fit

```
 Staff edit inventory             Counter tech types "18 outback" or "225 65 17"
 in Google Sheets                             │
        │                                     ▼
        │ every 5 min             ┌───────────────────────────┐
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
| Automatic Sheets sync | Not started (phase 2). |
| Counter app wired to real data | Not started (phase 3). |

## Build order

**Phase 0: accounts (half a day).** Supabase project, GitHub repo, Vercel account, Google Cloud service account for Sheets. Run migrations 001, 002, 003 in the Supabase SQL editor. Run `npm run seed-models` once.

**Phase 1: inventory into the database (1 to 2 days).** Put tires on one tab and wheels on another, each with one header row. Paste each tab into the importer, fix what it flags in the sheet, re-paste until rejected is zero, run the SQL. Done when the counter's sample sizes can be answered from Supabase.

**Phase 2: automatic sync (2 to 3 days).** A `/api/sync/sheets` route reads both tabs with the service account, runs the same cleaner, and replaces rows in one transaction. It writes rejected rows to a "Sync issues" tab in the sheet so staff see what to fix. Runs every 5 minutes (Vercel Cron) plus a "Sync now" button. Done when a qty changed in the sheet shows at the counter within 5 minutes.

**Phase 3: counter app on real data (3 to 5 days).** Move the prototype screen into the Next.js app. Add `/api/tires?size=` and `/api/wheels?bolt=&bore=`. Swap the sample arrays for the fitment, vehicles, inventory and search-log routes. Fees and distributor links come from `shop_settings`. Done when the prototype's test searches give the same answers on real stock.

**Phase 4: lock it down (1 day).** Staff sign in (Supabase Auth, or Vercel password protection for a single shared counter login). Keys stay in server env only.

**Phase 5: go live (1 week side by side).** Use the counter beside the sheet. Compare a day's quotes. Check `missed_demand_30d` at the end of the week.

**Later:** a "Sold" button that lowers qty and writes back to the sheet; tire-and-wheel winter package quotes; Looker Studio reports.

## Decisions needed from the shop

1. **Sheet layout.** Is it one tab for tires and one for wheels today? A copy or CSV export lets the importer be tuned to your real columns.
2. **Who lowers qty after a sale.** Staff in the sheet (simplest, works from day one) or a counter "Sold" button (needs write-back to the sheet).
3. **Logins.** One shared counter login, or one per person (lets the search log show who quoted what).
4. **Wheel-Size plan.** The free key is listed as testing only; Basic is $450/yr for production use.
5. **Hosting.** Vercel's free tier fits a single shop. Pick a domain if you want one (e.g. counter.greencartires.ca).
