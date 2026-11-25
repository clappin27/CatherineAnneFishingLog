-- Photos: a private gallery per boat, optionally attached to a bite.
-- Files live in the private storage bucket "catch-photos" at <boat_id>/<photo_id>.jpg (full) and
-- <boat_id>/<photo_id>_t.jpg (thumbnail). Only crew of that boat can read or add them.

create table public.catch_photos (
  id          uuid primary key,                         -- made on the phone, so offline uploads retry safely
  boat_id     uuid not null references public.boats(id) on delete cascade,
  catch_id    uuid,                                     -- the bite it belongs to (no FK: the bite may upload after the photo row is queued)
  path        text not null unique,
  thumb_path  text not null,
  width       int check (width between 1 and 10000),
  height      int check (height between 1 and 10000),
  fish        text check (char_length(fish) <= 60),        -- what's in the picture: a billfish species, mahi, tuna, wahoo...
  caption     text check (char_length(caption) <= 300),
  taken_at    timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index catch_photos_boat_updated_idx on public.catch_photos (boat_id, updated_at);
create index catch_photos_catch_idx on public.catch_photos (catch_id);
create index catch_photos_created_by_idx on public.catch_photos (created_by);

create or replace function private.catch_photos_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.path <> new.boat_id::text || '/' || new.id::text || '.jpg'
     or new.thumb_path <> new.boat_id::text || '/' || new.id::text || '_t.jpg' then
    raise exception 'Photo path does not match its boat';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.boat_id is distinct from old.boat_id or new.path is distinct from old.path then
      raise exception 'A photo cannot be moved to another boat';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger catch_photos_before_write before insert or update on public.catch_photos
  for each row execute function private.catch_photos_before_write();
revoke execute on function private.catch_photos_before_write() from public, anon, authenticated;

alter table public.catch_photos enable row level security;
create policy "crew read photos" on public.catch_photos for select to authenticated
  using (private.is_boat_member(boat_id));
create policy "crew add photos" on public.catch_photos for insert to authenticated
  with check (private.is_boat_member(boat_id));
create policy "crew edit photos" on public.catch_photos for update to authenticated
  using (private.is_boat_member(boat_id)) with check (private.is_boat_member(boat_id));
revoke all on public.catch_photos from anon;
revoke delete on public.catch_photos from authenticated;
grant select, insert, update on public.catch_photos to authenticated;

alter publication supabase_realtime add table public.catch_photos;

-- Storage: private bucket, JPEG only, 6 MB cap per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catch-photos', 'catch-photos', false, 6291456, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- True when the first folder of a storage path is a boat the signed-in person crews on.
create or replace function private.can_use_photo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare bid uuid;
begin
  begin
    bid := split_part(p_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return private.is_boat_member(bid)
     and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}(_t)?\.jpg$';
end $$;
revoke execute on function private.can_use_photo_path(text) from public, anon;
grant execute on function private.can_use_photo_path(text) to authenticated;

create policy "crew view boat photos" on storage.objects for select to authenticated
  using (bucket_id = 'catch-photos' and private.can_use_photo_path(name));
create policy "crew upload boat photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'catch-photos' and private.can_use_photo_path(name));
