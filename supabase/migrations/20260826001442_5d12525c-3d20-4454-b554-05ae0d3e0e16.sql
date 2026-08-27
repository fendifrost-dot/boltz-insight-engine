
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner','staff');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('owner','staff'))
$$;

create policy "user_roles_self_select" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'owner'));

-- Bootstrap: the first account created becomes owner (internal owner-only tool).
create or replace function public.bootstrap_first_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where role = 'owner') then
    insert into public.user_roles (user_id, role) values (new.id, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_bootstrap_owner on auth.users;
create trigger on_auth_user_created_bootstrap_owner
after insert on auth.users
for each row execute function public.bootstrap_first_owner();

-- Tighten lead-inbox policies to staff/owner only.
drop policy if exists "agent_runs_authenticated_select" on public.agent_runs;
drop policy if exists "escalations_authenticated_all" on public.escalations;
drop policy if exists "integration_health_authenticated_select" on public.integration_health_snapshots;
drop policy if exists "lead_events_authenticated_insert" on public.lead_events;
drop policy if exists "lead_events_authenticated_select" on public.lead_events;
drop policy if exists "leads_authenticated_all" on public.leads;
drop policy if exists "message_jobs_authenticated_select" on public.message_jobs;
drop policy if exists "message_jobs_authenticated_update" on public.message_jobs;
drop policy if exists "message_threads_authenticated_all" on public.message_threads;
drop policy if exists "messages_authenticated_all" on public.messages;
drop policy if exists "ringcentral_subscriptions_authenticated_select" on public.ringcentral_subscriptions;

create policy "agent_runs_staff_select" on public.agent_runs for select to authenticated using (public.is_staff(auth.uid()));
create policy "escalations_staff_all" on public.escalations for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "integration_health_owner_select" on public.integration_health_snapshots for select to authenticated using (public.has_role(auth.uid(),'owner'));
create policy "lead_events_staff_select" on public.lead_events for select to authenticated using (public.is_staff(auth.uid()));
create policy "lead_events_staff_insert" on public.lead_events for insert to authenticated with check (public.is_staff(auth.uid()));
create policy "leads_staff_all" on public.leads for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "message_jobs_staff_select" on public.message_jobs for select to authenticated using (public.is_staff(auth.uid()));
create policy "message_jobs_staff_update" on public.message_jobs for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "message_threads_staff_all" on public.message_threads for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "messages_staff_all" on public.messages for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "ringcentral_subscriptions_owner_select" on public.ringcentral_subscriptions for select to authenticated using (public.has_role(auth.uid(),'owner'));
