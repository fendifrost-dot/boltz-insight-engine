-- Role probe RPCs must not allow cross-user enumeration.
-- Callers may only evaluate roles for auth.uid(); mismatched _user_id returns false.

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user_id = auth.uid()
    and exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role = _role
    );
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user_id = auth.uid()
    and exists (
      select 1
      from public.user_roles
      where user_id = auth.uid()
        and role in ('owner', 'staff')
    );
$$;

revoke all on function public.has_role(uuid, public.app_role) from public, anon;
revoke all on function public.is_staff(uuid) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_staff(uuid) to authenticated;
