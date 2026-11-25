-- Pilot: the app serves one boat (Catherine Anne). New boats can't be created from the app.
-- To open it to other boats later: grant execute on function public.create_boat(text, text) to authenticated;
-- and set PILOT_BOAT_ONLY = false in app/config.js.
revoke execute on function public.create_boat(text, text) from authenticated;

-- Deletes are soft (deleted_at) so offline phones learn about them; no hard deletes from the app.
drop policy if exists "captains erase catches" on public.catches;
revoke delete on public.catches from authenticated;
drop policy if exists "captains delete their boats" on public.boats;
revoke delete on public.boats from authenticated;

-- Failed invite-code attempts, for rate limiting join_boat.
create table if not exists private.join_failures (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists join_failures_user_at_idx on private.join_failures (user_id, at);
revoke all on private.join_failures from public, anon, authenticated;

create or replace function public.join_boat(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); bid uuid; clean text;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if (select count(*) from private.join_failures where user_id = uid and at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many wrong codes. Wait an hour and try again.';
  end if;
  clean := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select id into bid from public.boats where invite_code = clean;
  if bid is null then
    insert into private.join_failures (user_id) values (uid);
    return null;  -- caller shows "That boat code isn't right"; returning (not raising) keeps the failure row
  end if;
  insert into public.boat_members (boat_id, user_id, role) values (bid, uid, 'crew')
  on conflict (boat_id, user_id) do nothing;
  return bid;
end $$;

-- Removing someone also changes the invite code, so they can't rejoin with the old one.
-- Locking the boat row stops two captains from demoting/removing each other at the same moment.
drop function if exists public.remove_member(uuid, uuid);
create function public.remove_member(p_boat uuid, p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if p_user <> auth.uid() and not private.is_boat_captain(p_boat) then
    raise exception 'Only a captain can remove someone else';
  end if;
  perform 1 from public.boats where id = p_boat for update;
  if exists (select 1 from public.boat_members where boat_id = p_boat and user_id = p_user and role = 'captain')
     and (select count(*) from public.boat_members where boat_id = p_boat and role = 'captain') = 1 then
    raise exception 'Make someone else captain first';
  end if;
  delete from public.boat_members where boat_id = p_boat and user_id = p_user;
  if p_user <> auth.uid() then
    code := private.new_invite_code();
    update public.boats set invite_code = code where id = p_boat;
  end if;
  return code;
end $$;

create or replace function public.set_member_role(p_boat uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_boat_captain(p_boat) then raise exception 'Only a captain can do that'; end if;
  if p_role not in ('captain', 'crew') then raise exception 'Unknown role'; end if;
  perform 1 from public.boats where id = p_boat for update;
  if p_role = 'crew' and (select count(*) from public.boat_members
                          where boat_id = p_boat and role = 'captain' and user_id <> p_user) = 0 then
    raise exception 'A boat needs at least one captain';
  end if;
  update public.boat_members set role = p_role where boat_id = p_boat and user_id = p_user;
end $$;

revoke execute on function public.join_boat(text), public.remove_member(uuid, uuid), public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.join_boat(text), public.remove_member(uuid, uuid), public.set_member_role(uuid, uuid, text) to authenticated;
