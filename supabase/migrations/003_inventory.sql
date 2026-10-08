-- Inventory tables. Filled from the Google Sheets, either by the importer page (paste SQL) or the sync route.
-- Each import replaces all rows from that source in one transaction, so the sheet stays the source of truth.

create table if not exists tires (
  id            bigint generated always as identity primary key,
  tire_size     text not null check (tire_size ~ '^\d{3}/\d{2}R\d{2}$'),   -- "225/65R17"
  section_width int  not null,
  aspect_ratio  int  not null,
  rim_diameter  int  not null,
  is_lt         boolean not null default false,  -- light-truck (LT) construction
  brand         text,
  model         text,
  season        text check (season in ('W','AW','AS','S')),  -- winter, all-weather, all-season, summer
  condition     text not null check (condition in ('new','used')),
  tread_32nds   int  check (tread_32nds between 0 and 32),
  load_index    int  check (load_index between 60 and 160),
  load_index_dual int,                           -- LT dual load, e.g. 120/116 -> 116
  speed_rating  text check (speed_rating ~ '^[A-Z]$'),
  is_xl         boolean not null default false,
  dot_year      int  check (dot_year between 1990 and 2100),
  qty           int  not null default 0 check (qty >= 0),
  price         numeric(10,2),                   -- per tire, before install and tax
  location      text,                            -- "Rack B-04"
  notes         text,
  source        text not null,                   -- which sheet/tab it came from
  source_row    int,                             -- row number in the sheet, to find it again
  raw           jsonb,                           -- the original row, untouched
  imported_at   timestamptz not null default now()
);
create index if not exists tires_size_idx on tires (tire_size) where qty > 0;
create index if not exists tires_rim_idx  on tires (rim_diameter, section_width);

create table if not exists wheels (
  id            bigint generated always as identity primary key,
  wheel_type    text not null check (wheel_type in ('alloy','steel')),
  condition     text not null check (condition in ('new','used')),
  grade         text check (grade in ('A','B','C')),   -- used wheels: A clean, B light wear, C cosmetic damage
  diameter      numeric(4,1) not null check (diameter between 12 and 26),
  width         numeric(4,1) check (width between 3 and 14),
  bolt_pattern  text not null check (bolt_pattern ~ '^\d{1,2}x\d{2,3}(\.\d)?$'),   -- "5x114.3"
  bolt_pattern_alt text check (bolt_pattern_alt ~ '^\d{1,2}x\d{2,3}(\.\d)?$'),    -- dual-drilled
  center_bore   numeric(5,1) check (center_bore between 40 and 180),
  wheel_offset  int  check (wheel_offset between -80 and 80),
  description   text,
  finish        text,
  lug_seat      text check (lug_seat in ('conical','ball','flat')),
  has_tpms      boolean,
  qty           int  not null default 0 check (qty >= 0),
  price         numeric(10,2),                  -- per wheel
  location      text,
  notes         text,
  source        text not null,
  source_row    int,
  raw           jsonb,
  imported_at   timestamptz not null default now()
);
create index if not exists wheels_fit_idx on wheels (bolt_pattern, diameter) where qty > 0;
create index if not exists wheels_fit_alt_idx on wheels (bolt_pattern_alt, diameter) where qty > 0 and bolt_pattern_alt is not null;

-- Shop settings that were in the prototype's browser storage: fees, tax, distributor links.
create table if not exists shop_settings (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into shop_settings (key, value) values
  ('fees', '{"mountBalance":20,"disposal":5,"tpmsKit":10,"hubRingsSet":25,"lugSet":45,"tpmsSensor":65,"taxPct":13,"altTolerancePct":3}'),
  ('distributors', '[]')
on conflict (key) do nothing;

alter table tires enable row level security;
alter table wheels enable row level security;
alter table shop_settings enable row level security;
