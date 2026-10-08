-- Automatic Google Sheets sync (POST /api/sync/sheets). Run after 003_inventory.sql.

-- One row per sync that changed something (or was blocked/failed). Runs where the sheet was unchanged
-- only bump checked_at on the latest row, so a 5-minute schedule doesn't flood the table.
create table if not exists inventory_syncs (
  id           bigint generated always as identity primary key,
  synced_at    timestamptz not null default now(),
  checked_at   timestamptz not null default now(),  -- last time the sheet was read and found the same
  trigger      text not null check (trigger in ('cron','manual')),
  kind         text not null check (kind in ('tires','wheels')),
  tabs         text[] not null,
  status       text not null check (status in ('ok','blocked','error')),
  rows_synced  int,
  qty_on_hand  int,
  rejected     int,
  warnings     int,
  content_hash text,                                -- of the sheet cells; equal hash = nothing to do
  message      text
);
create index if not exists inventory_syncs_kind_idx on inventory_syncs (kind, id desc);

-- Replaces every row of tires or wheels with p_rows (a JSON array of cleaned rows) in one transaction:
-- the counter never sees a half-loaded table. The sheet is the source of truth, so rows from the
-- importer page are replaced too. Returns the number of rows inserted.
create or replace function replace_inventory(p_kind text, p_rows jsonb) returns int language plpgsql as $$
declare n int;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array'; end if;
  if p_kind = 'tires' then
    delete from tires where true;   -- "where true": Supabase's safeupdate refuses a bare delete
    insert into tires (tire_size, section_width, aspect_ratio, rim_diameter, is_lt, brand, model, season, condition, tread_32nds,
                       load_index, load_index_dual, speed_rating, is_xl, dot_year, qty, price, location, notes, source, source_row, raw)
    select tire_size, section_width, aspect_ratio, rim_diameter, coalesce(is_lt, false), brand, model, season, condition, tread_32nds,
           load_index, load_index_dual, speed_rating, coalesce(is_xl, false), dot_year, coalesce(qty, 0), price, location, notes, source, source_row, raw
    from jsonb_populate_recordset(null::tires, p_rows);
  elsif p_kind = 'wheels' then
    delete from wheels where true;
    insert into wheels (wheel_type, condition, grade, diameter, width, bolt_pattern, bolt_pattern_alt, center_bore, wheel_offset,
                        description, finish, lug_seat, has_tpms, qty, price, location, notes, source, source_row, raw)
    select wheel_type, condition, grade, diameter, width, bolt_pattern, bolt_pattern_alt, center_bore, wheel_offset,
           description, finish, lug_seat, has_tpms, coalesce(qty, 0), price, location, notes, source, source_row, raw
    from jsonb_populate_recordset(null::wheels, p_rows);
  else
    raise exception 'p_kind must be tires or wheels, got %', p_kind;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

alter table inventory_syncs enable row level security;

-- Only the server (service role) may call it. RLS already blocks anon writes; this makes it explicit.
do $$ begin
  revoke execute on function replace_inventory(text, jsonb) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function replace_inventory(text, jsonb) from anon, authenticated;
  end if;
end $$;
