-- Let a deleted photo's files be removed from storage: by the person who added the photo, or a captain.
create or replace function private.can_remove_photo_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare bid uuid;
begin
  begin
    bid := split_part(p_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  if not private.can_use_photo_path(p_name) then return false; end if;
  return private.is_boat_captain(bid)
      or exists (select 1 from public.catch_photos c
                 where (c.path = p_name or c.thumb_path = p_name) and c.created_by = auth.uid());
end $$;
revoke execute on function private.can_remove_photo_path(text) from public, anon;
grant execute on function private.can_remove_photo_path(text) to authenticated;

create policy "crew remove boat photos" on storage.objects for delete to authenticated
  using (bucket_id = 'catch-photos' and private.can_remove_photo_path(name));
