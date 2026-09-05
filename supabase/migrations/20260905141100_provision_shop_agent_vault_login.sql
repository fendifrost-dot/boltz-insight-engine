-- Provision the dedicated shop-agent Auth user and store its password in
-- Vault so silent auto-login can run without Lovable env secrets being set
-- in chat or git. The password is generated in-database and is never
-- selected back to the client.

create or replace function public.read_agent_auth_secret(secret_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  val text;
begin
  if secret_name is null or secret_name not in ('AGENT_AUTH_EMAIL', 'AGENT_AUTH_PASSWORD') then
    raise exception 'forbidden secret name';
  end if;

  select ds.decrypted_secret
    into val
  from vault.decrypted_secrets ds
  where ds.name = secret_name
  limit 1;

  return val;
end;
$$;

revoke all on function public.read_agent_auth_secret(text) from public, anon, authenticated;
grant execute on function public.read_agent_auth_secret(text) to service_role;

do $$
declare
  pwd text;
  new_id uuid := gen_random_uuid();
  existing uuid;
begin
  select id into existing
  from auth.users
  where email = 'agents@boltzautoinc.com';

  if existing is not null then
    insert into public.user_roles (user_id, role)
    values (existing, 'staff')
    on conflict (user_id, role) do nothing;

    if not exists (select 1 from vault.secrets where name = 'AGENT_AUTH_EMAIL') then
      perform vault.create_secret(
        'agents@boltzautoinc.com',
        'AGENT_AUTH_EMAIL',
        'Shop-agent stored login email',
        null
      );
    end if;
    return;
  end if;

  pwd := encode(extensions.gen_random_bytes(32), 'hex');

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_id,
    'authenticated',
    'authenticated',
    'agents@boltzautoinc.com',
    extensions.crypt(pwd, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    new_id,
    jsonb_build_object('sub', new_id::text, 'email', 'agents@boltzautoinc.com'),
    'email',
    new_id::text,
    now(),
    now(),
    now()
  );

  insert into public.user_roles (user_id, role)
  values (new_id, 'staff')
  on conflict (user_id, role) do nothing;

  if not exists (select 1 from vault.secrets where name = 'AGENT_AUTH_EMAIL') then
    perform vault.create_secret(
      'agents@boltzautoinc.com',
      'AGENT_AUTH_EMAIL',
      'Shop-agent stored login email',
      null
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'AGENT_AUTH_PASSWORD') then
    perform vault.create_secret(
      pwd,
      'AGENT_AUTH_PASSWORD',
      'Shop-agent stored login password',
      null
    );
  end if;
end;
$$;
