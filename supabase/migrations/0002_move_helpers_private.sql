-- Keep RLS helper functions out of the public API (/rest/v1/rpc); policies keep working because they reference the function, not its name.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_boat_member(uuid)   set schema private;
alter function public.is_boat_captain(uuid)  set schema private;
alter function public.shares_boat_with(uuid) set schema private;
alter function public.new_invite_code()      set schema private;
alter function public.handle_new_user()      set schema private;
alter function public.catches_before_write() set schema private;
-- create_boat, regenerate_invite, set_member_role and remove_member were re-created
-- to call private.* instead of public.* (same bodies as 0001 otherwise).
