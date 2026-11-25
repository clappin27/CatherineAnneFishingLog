-- Fishing days: one entry per day of fishing that isn't a billfish bite (mahi, tuna, wahoo, bottom fishing...).
create table public.fishing_days (
  id           uuid primary key,                       -- made on the phone, so offline saves retry safely
  boat_id      uuid not null references public.boats(id) on delete cascade,
  day_date     date not null,
  fishing_type text check (char_length(fishing_type) <= 60),
  location     text check (char_length(location) <= 120),
  crew         text[] check (cardinality(crew) <= 30),
  seas         text check (char_length(seas) <= 60),
  water_temp_f numeric check (water_temp_f between 20 and 120),
  catches      jsonb not null default '{}'::jsonb check (jsonb_typeof(catches) = 'object' and pg_column_size(catches) < 8000),
  notes        text check (char_length(notes) <= 4000),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index fishing_days_boat_updated_idx on public.fishing_days (boat_id, updated_at);
create index fishing_days_boat_date_idx on public.fishing_days (boat_id, day_date);
create index fishing_days_created_by_idx on public.fishing_days (created_by);

create or replace function private.fishing_days_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.boat_id is distinct from old.boat_id then raise exception 'A fishing day cannot be moved to another boat'; end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger fishing_days_before_write before insert or update on public.fishing_days
  for each row execute function private.fishing_days_before_write();
revoke execute on function private.fishing_days_before_write() from public, anon, authenticated;

alter table public.fishing_days enable row level security;
create policy "crew read days" on public.fishing_days for select to authenticated using (private.is_boat_member(boat_id));
create policy "crew add days" on public.fishing_days for insert to authenticated with check (private.is_boat_member(boat_id));
create policy "crew edit days" on public.fishing_days for update to authenticated
  using (private.is_boat_member(boat_id)) with check (private.is_boat_member(boat_id));
revoke all on public.fishing_days from anon;
revoke delete on public.fishing_days from authenticated;
grant select, insert, update on public.fishing_days to authenticated;
alter publication supabase_realtime add table public.fishing_days;

-- Photos can belong to a fishing day as well as to a billfish bite.
alter table public.catch_photos add column day_id uuid;
create index catch_photos_day_idx on public.catch_photos (day_id);
