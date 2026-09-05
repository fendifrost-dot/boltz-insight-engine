CREATE OR REPLACE FUNCTION public.write_agent_auth_secret(secret_name text, secret_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF secret_name NOT IN ('AGENT_AUTH_EMAIL', 'AGENT_AUTH_PASSWORD') THEN
    RAISE EXCEPTION 'unsupported secret name';
  END IF;
  SELECT id INTO existing_id FROM vault.secrets WHERE name = secret_name LIMIT 1;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(secret_value, secret_name);
  ELSE
    PERFORM vault.update_secret(existing_id, secret_value);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.write_agent_auth_secret(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_agent_auth_secret(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.write_agent_auth_secret(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.write_agent_auth_secret(text, text) TO service_role;