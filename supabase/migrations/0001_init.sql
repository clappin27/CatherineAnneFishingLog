-- Billfish Log: boats, crews and catch logs.
-- Every boat's data is private to the people on that boat (row level security).

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  created_at   timestamptz not null default now()
);

create table public.boats (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  home_port   text not null default '' check (char_length(home_port) <= 80),
  invite_code text not null unique,
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 20000),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.boat_members (
  boat_id   uuid not null references public.boats(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'crew' check (role in ('captain', 'crew')),
  joined_at timestamptz not null default now(),
  primary key (boat_id, user_id)
);
create index boat_members_user_idx on public.boat_members (user_id);

create table public.catches (
  id           uuid primary key default gen_random_uuid(),  -- usually made on the phone so offline saves can retry safely
  boat_id      uuid not null references public.boats(id) on delete cascade,
  catch_date   date not null,
  bite_time    time,
  species      text check (char_length(species)   <= 60),
  result       text check (char_length(result)    <= 60),
  angler       text check (char_length(angler)    <= 60),
  spread       text check (char_length(spread)    <= 60),
  lure_type    text check (char_length(lure_type) <= 60),
  lure_name    text check (char_length(lure_name) <= 120),
  tide         text check (char_length(tide)      <= 60),
  location     text check (char_length(location)  <= 120),
  lat          double precision check (lat between -90 and 90),
  lng          double precision check (lng between -180 and 180),
  depth_ft     numeric check (depth_ft between 0 and 40000),
  water_temp_f numeric check (water_temp_f between 20 and 120),
  omni         text check (char_length(omni)      <= 60),
  fight_min    numeric check (fight_min between 0 and 1440),
  weight_lb    numeric check (weight_lb between 0 and 3000),
  seas         text check (char_length(seas)      <= 60),
  notes        text check (char_length(notes)     <= 2000),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz                                    -- soft delete, so offline phones learn about deletions
);
create index catches_boat_updated_idx on public.catches (boat_id, updated_at);
create index catches_boat_date_idx    on public.catches (boat_id, catch_date);
create index catches_created_by_idx   on public.catches (created_by);
create index boats_created_by_idx     on public.boats (created_by);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_boat_member(p_boat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.boat_members m
                 where m.boat_id = p_boat and m.user_id = (select auth.uid()));
$$;

create or replace function public.is_boat_captain(p_boat uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.boat_members m
                 where m.boat_id = p_boat and m.user_id = (select auth.uid()) and m.role = 'captain');
$$;

create or replace function public.shares_boat_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.boat_members a
                 join public.boat_members b on a.boat_id = b.boat_id
                 where a.user_id = (select auth.uid()) and b.user_id = p_user);
$$;

create or replace function public.new_invite_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I/L
  b bytea; code text;
begin
  loop
    b := extensions.gen_random_bytes(8);
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.boats where invite_code = code);
  end loop;
  return code;
end $$;

-- ---------------------------------------------------------------- triggers
-- New sign-up -> profile row (name comes from the sign-up form)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), ''), 60))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Server owns who/when on every catch
create or replace function public.catches_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.boat_id is distinct from old.boat_id then
      raise exception 'A catch cannot be moved to another boat';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger catches_before_write before insert or update on public.catches
  for each row execute function public.catches_before_write();

-- ---------------------------------------------------------------- actions (called from the app)
create or replace function public.create_boat(p_name text, p_home_port text default '')
returns public.boats language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.boats;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if (select count(*) from public.boat_members where user_id = uid and role = 'captain') >= 10 then
    raise exception 'You can captain up to 10 boats';
  end if;
  insert into public.boats (name, home_port, invite_code, created_by)
  values (trim(p_name), coalesce(trim(p_home_port), ''), public.new_invite_code(), uid)
  returning * into b;
  insert into public.boat_members (boat_id, user_id, role) values (b.id, uid, 'captain');
  return b;
end $$;

create or replace function public.join_boat(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); bid uuid; clean text;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  clean := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select id into bid from public.boats where invite_code = clean;
  if bid is null then raise exception 'No boat has that invite code'; end if;
  insert into public.boat_members (boat_id, user_id, role) values (bid, uid, 'crew')
  on conflict (boat_id, user_id) do nothing;
  return bid;
end $$;

create or replace function public.regenerate_invite(p_boat uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if not public.is_boat_captain(p_boat) then raise exception 'Only a captain can do that'; end if;
  code := public.new_invite_code();
  update public.boats set invite_code = code where id = p_boat;
  return code;
end $$;

create or replace function public.set_member_role(p_boat uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_boat_captain(p_boat) then raise exception 'Only a captain can do that'; end if;
  if p_role not in ('captain', 'crew') then raise exception 'Unknown role'; end if;
  if p_role = 'crew' and (select count(*) from public.boat_members
                          where boat_id = p_boat and role = 'captain' and user_id <> p_user) = 0 then
    raise exception 'A boat needs at least one captain';
  end if;
  update public.boat_members set role = p_role where boat_id = p_boat and user_id = p_user;
end $$;

create or replace function public.remove_member(p_boat uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user <> auth.uid() and not public.is_boat_captain(p_boat) then
    raise exception 'Only a captain can remove someone else';
  end if;
  if exists (select 1 from public.boat_members where boat_id = p_boat and user_id = p_user and role = 'captain')
     and (select count(*) from public.boat_members where boat_id = p_boat and role = 'captain') = 1 then
    raise exception 'Make someone else captain first';
  end if;
  delete from public.boat_members where boat_id = p_boat and user_id = p_user;
end $$;

-- ---------------------------------------------------------------- row level security
alter table public.profiles     enable row level security;
alter table public.boats        enable row level security;
alter table public.boat_members enable row level security;
alter table public.catches      enable row level security;

create policy "see own and crewmates' profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_boat_with(id));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "crew see their boats" on public.boats for select to authenticated
  using (public.is_boat_member(id));
create policy "captains edit their boats" on public.boats for update to authenticated
  using (public.is_boat_captain(id)) with check (public.is_boat_captain(id));
create policy "captains delete their boats" on public.boats for delete to authenticated
  using (public.is_boat_captain(id));

create policy "crew see their boat's crew" on public.boat_members for select to authenticated
  using (public.is_boat_member(boat_id));

create policy "crew read catches" on public.catches for select to authenticated
  using (public.is_boat_member(boat_id));
create policy "crew add catches" on public.catches for insert to authenticated
  with check (public.is_boat_member(boat_id));
create policy "crew edit catches" on public.catches for update to authenticated
  using (public.is_boat_member(boat_id)) with check (public.is_boat_member(boat_id));
create policy "captains erase catches" on public.catches for delete to authenticated
  using (public.is_boat_captain(boat_id));

-- ---------------------------------------------------------------- privileges
revoke all on public.profiles, public.boats, public.boat_members, public.catches from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant  update (display_name) on public.profiles to authenticated;
revoke insert, update on public.boats from authenticated;
grant  update (name, home_port, settings) on public.boats to authenticated;
revoke insert, update, delete on public.boat_members from authenticated;
grant  select, insert, update, delete on public.catches to authenticated;

revoke execute on function public.is_boat_member(uuid), public.is_boat_captain(uuid), public.shares_boat_with(uuid),
  public.new_invite_code(), public.handle_new_user(), public.catches_before_write(),
  public.create_boat(text, text), public.join_boat(text), public.regenerate_invite(uuid),
  public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid)
  from public, anon;
grant execute on function public.is_boat_member(uuid), public.is_boat_captain(uuid), public.shares_boat_with(uuid),
  public.create_boat(text, text), public.join_boat(text), public.regenerate_invite(uuid),
  public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid)
  to authenticated;
revoke execute on function public.new_invite_code(), public.handle_new_user(), public.catches_before_write() from authenticated;

-- live updates for phones that are online
alter publication supabase_realtime add table public.catches;
