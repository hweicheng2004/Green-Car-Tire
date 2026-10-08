-- Wheel-Size lookups are cached here so each vehicle costs one API hit, ever (until it goes stale).

-- Every make/model sold in the region. Filled once by scripts/seed-models.ts, refreshed yearly.
-- Lets the counter turn "18 outback" into make=subaru, model=outback without spending API hits.
create table if not exists vehicle_models (
  make_slug   text not null,
  make_name   text not null,
  model_slug  text not null,
  model_name  text not null,
  region      text not null default 'cdm',
  -- "cr-v" -> "crv", "f-150" -> "f150", so counter shorthand matches
  model_compact text generated always as (regexp_replace(lower(model_slug), '[^a-z0-9]', '', 'g')) stored,
  make_compact  text generated always as (regexp_replace(lower(make_slug),  '[^a-z0-9]', '', 'g')) stored,
  primary key (make_slug, model_slug, region)
);
create index if not exists vehicle_models_compact_idx on vehicle_models (model_compact text_pattern_ops);

-- Normalized fitment card per vehicle-year (see lib/fitment.ts for the JSON shape).
create table if not exists vehicle_fitment (
  make_slug  text not null,
  model_slug text not null,
  year       int  not null,
  region     text not null default 'cdm',
  data       jsonb not null,            -- Fitment
  raw        jsonb,                     -- untouched Wheel-Size response, for re-normalizing later without new hits
  lug_seat   text check (lug_seat in ('conical','ball','flat')),  -- shop override; wins over the make default
  fetched_at timestamptz not null default now(),
  primary key (make_slug, model_slug, year, region)
);

-- Count API hits per day so the counter can warn before the plan quota runs out.
create table if not exists wheelsize_usage (
  day  date primary key default current_date,
  hits int  not null default 0
);
create or replace function wheelsize_hit() returns int language sql as $$
  insert into wheelsize_usage (day, hits) values (current_date, 1)
  on conflict (day) do update set hits = wheelsize_usage.hits + 1
  returning hits;
$$;

-- Only the server (service role) touches these tables.
alter table vehicle_models  enable row level security;
alter table vehicle_fitment enable row level security;
alter table wheelsize_usage enable row level security;
