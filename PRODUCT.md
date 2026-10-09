# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Front-counter staff at Green Car Tires, a single tire shop in Ontario (shop time zone America/Toronto). They quote walk-in and phone customers on new and used tires and wheels. They work on a shared counter PC, mostly by keyboard, often with a customer waiting in front of them or on the line.

A secondary audience is whoever keeps the inventory up to date. They edit stock in Google Sheets, then check `/sync` and run `/import` to fix rows the cleaner can't read.

## Product Purpose

The Green Car Tires Counter turns one question ("what fits this car and what do we have?") into a quote the customer can say yes to on the spot. A staff member types a vehicle (year, make, model) or a tire size. In one screen they see the vehicle's fitment, matching stock on hand, and an out-the-door quote that includes shop fees and HST. When nothing suitable is on the shelf, it opens a special order on TireConnect or another distributor.

Success means a correct quote in seconds without leaving the screen, no API spend on typos or wrong models, and a search log that shows the missed demand worth stocking.

## Positioning

The shop's competitive positioning (why customers choose Green Car Tires) is **undecided**. Do not invent it.

What sets the tool apart from a generic inventory lookup:
- Fitment and stock are joined automatically by tire size, bolt pattern, and bore. It suggests alternate sizes within a diameter tolerance and treats wheel offset within a set number of mm of OE as a fit.
- Every search is logged, which feeds the `missed_demand_30d` and `top_vehicles_30d` reports.

## Operating Context

- Staff edit stock in Google Sheets (Tires and Wheels tabs). Supabase pg_cron syncs it into Supabase every 5 minutes. Rows the sync rejects go to a "Sync issues" tab.
- Fitment comes from the Wheel-Size API, which is queried for both Canadian and US data and merged. Results are cached for 180 days. A lookup for a vehicle not yet saved costs 2 hits and always needs the user to confirm it.
- Special orders open TireConnect, with the size filled into the URL or copied to the clipboard.
- The screen is built for the keyboard: V/S focus the search boxes, ↑↓ pick a tire, 1–4 set quantity, T/W switch between tires and wheels, [ ] step through OE sizes, C copies the quote, O orders, and Esc returns to search.
- Shop fees and rules (mount & balance, disposal, TPMS, hub rings, lugs, HST %, tolerances, distributor links) are saved separately on each counter PC.
- Demo mode runs on sample data with no accounts.

## Capabilities and Constraints

- Next.js 14 on Vercel, with Supabase (Postgres), the Wheel-Size Fitment API v2, Google Sheets with a service account, and the Anthropic API for `/import`.
- Surfaces: `/` is the counter, `/sync` shows sync status with Sync now / Sync anyway, and `/import` turns a spreadsheet into SQL and can fix rows with Claude.
- The free Wheel-Size key allows 300 hits/day and is for testing only. Cached vehicles keep working when the quota runs out, and new ones show "check the door placard".
- Keys stay on the server. `ADMIN_PASSWORD` protects the Claude import.
- Live mode has not yet been tested against real accounts.
- Open decisions (from PLAN.md): the sheet layout, who lowers qty after a sale (the sheet or a counter "Sold" button), one shared login or one per person, which Wheel-Size plan, and the domain.
- Later ideas: a Sold button with write-back to the sheet, winter tire-and-wheel package quotes, and Looker Studio reports.

## Brand Commitments

- Name: Green Car Tires, with the domain greencartires.ca.
- Logo: `public/logo.png` (the greencartires.ca logo), shown in the header and for 1 second on the load splash. It can be overridden with `NEXT_PUBLIC_LOGO`.
- Copy voice in the codebase: plain, direct, shop-floor language ("Order on TireConnect", "check the door placard").

## Evidence on Hand

- Demo inventory: `demo/demo-inventory.json` and `demo/demo-inventory.xlsx` hold made-up stock. They are not real shop data.
- A real Wheel-Size fixture: `test/fixture-outback-2018.json`.
- No customer testimonials, real stock figures, pricing, or usage metrics exist in the repo. Do not fabricate them.

## Product Principles

1. **Speed at the counter wins.** Each quote is one screen, works by keyboard first, and is ready on first paint. Anything typed goes straight into the boxes.
2. **Never spend by accident.** Paid lookups and API credit are only used after an explicit confirmation.
3. **Fail soft and keep quoting.** Stale cache, last good sync, and a fallback for when the quota runs out all come before a hard error.
4. **The sheet stays the source of truth.** The counter reads a clean copy, and problems are reported back where staff already work.
5. **Every search is data.** Log what was asked and whether it was in stock, so stocking decisions follow real demand.
