
revoke all on function public.bootstrap_first_owner() from public, anon, authenticated;
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
revoke all on function public.is_staff(uuid) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_staff(uuid) to authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.deny_lead_event_mutation() from public, anon, authenticated;
