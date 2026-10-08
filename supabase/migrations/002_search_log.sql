-- Every counter search is recorded, and every vehicle's factory sizes are stored as rows.

-- 1. Factory and optional sizes per vehicle-year, one row each. Written every time a fitment is saved.
--    Answers "which vehicles run 225/65R17?" for tire-size searches, with no API calls.
create table if not exists fitment_oe_sizes (
  make_slug    text not null,
  model_slug   text not null,
  year         int  not null,
  region       text not null,
  tire_size    text not null,          -- "225/65R17"
  load_index   int,
  speed_rating text,
  rim_diameter numeric,
  rim_width    numeric,
  rim_offset   numeric,
  stock        boolean not null,       -- true = factory size, false = approved option
  trims        text[] not null default '{}',
  primary key (make_slug, model_slug, year, region, tire_size, stock, rim_width, rim_offset),
  foreign key (make_slug, model_slug, year, region)
    references vehicle_fitment (make_slug, model_slug, year, region) on delete cascade
);
create index if not exists fitment_oe_sizes_size_idx on fitment_oe_sizes (tire_size);

-- Rebuild a vehicle's size rows from its fitment JSON. Called by the API after each save,
-- and once below to backfill vehicles already cached.
create or replace function sync_fitment_oe_sizes(p_make text, p_model text, p_year int, p_region text)
returns int language plpgsql as $$
declare n int;
begin
  delete from fitment_oe_sizes where make_slug = p_make and model_slug = p_model and year = p_year and region = p_region;
  insert into fitment_oe_sizes (make_slug, model_slug, year, region, tire_size, load_index, speed_rating,
                                rim_diameter, rim_width, rim_offset, stock, trims)
  select f.make_slug, f.model_slug, f.year, f.region,
         s->>'tire', (s->>'loadIndex')::int, s->>'speedRating',
         (s->>'rimDiameter')::numeric, coalesce((s->>'rimWidth')::numeric, 0), coalesce((s->>'offset')::numeric, 0),
         coalesce((s->>'stock')::boolean, true),
         coalesce(array(select jsonb_array_elements_text(s->'trims')), '{}')
  from vehicle_fitment f, jsonb_array_elements(f.data->'oe') s
  where f.make_slug = p_make and f.model_slug = p_model and f.year = p_year and f.region = p_region
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

select sync_fitment_oe_sizes(make_slug, model_slug, year, region) from vehicle_fitment;

-- 2. One row per settled counter search (not per keystroke).
create table if not exists counter_searches (
  id             bigint generated always as identity primary key,
  searched_at    timestamptz not null default now(),
  kind           text not null check (kind in ('vehicle','size')),
  query          text not null,          -- exactly what was typed: "18 outback", "225 65 17"
  year           int,
  make_slug      text,
  model_slug     text,
  tire_size      text,                   -- the size searched, or the OE size selected for a vehicle
  oe_sizes       text[],                 -- factory sizes shown for a vehicle search
  exact_in_stock int not null default 0, -- tires on hand in the exact size
  new_in_stock   int not null default 0, -- of those, new (not used)
  alt_in_stock   int not null default 0, -- tires on hand in safe alternate sizes
  wheels_in_stock int,                   -- wheel lines that fit (vehicle searches only)
  outcome        text not null check (outcome in ('in_stock','used_only','alternate_only','special_order','no_fitment','no_match')),
  fitment_source text check (fitment_source in ('cache','api','stale','none')),
  station        text,                   -- which counter PC, optional
  staff          text                    -- who was at the counter, optional
);
create index if not exists counter_searches_time_idx on counter_searches (searched_at desc);
create index if not exists counter_searches_size_idx on counter_searches (tire_size, searched_at desc);

-- 3. What customers ask for that you can't sell new from the shelf. Use it to decide what to stock.
create or replace view missed_demand_30d as
select tire_size,
       count(*)                                          as searches,
       count(*) filter (where outcome = 'special_order') as special_orders,
       count(*) filter (where outcome = 'alternate_only') as sold_alternate_maybe,
       count(*) filter (where outcome = 'used_only')     as used_only,
       max(searched_at)                                  as last_asked
from counter_searches
where searched_at > now() - interval '30 days'
  and tire_size is not null
  and outcome in ('special_order','alternate_only','used_only')
group by tire_size
order by searches desc;

-- Most-searched vehicles, for deciding which wheels and winter packages to stock.
create or replace view top_vehicles_30d as
select year, make_slug, model_slug, count(*) as searches,
       count(*) filter (where outcome = 'in_stock') as had_stock
from counter_searches
where kind = 'vehicle' and make_slug is not null and searched_at > now() - interval '30 days'
group by year, make_slug, model_slug
order by searches desc;

alter table fitment_oe_sizes enable row level security;
alter table counter_searches enable row level security;
