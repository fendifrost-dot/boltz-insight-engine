-- Staff JWTs from current Supabase Auth carry the role in request.jwt.claims
-- (JSON). The shop desk guard only read the legacy GUC request.jwt.claim.role,
-- so a session with only the claims JSON was treated as "no role" and could
-- set lifecycle to Paid or forge desk markers.
--
-- Resolve the role the same way auth.role() does. auth.role() is not called:
-- this function pins search_path to public, and a database that only stubs
-- auth.uid() would not have auth.role(). NULL (no JWT) stays the owner /
-- migration path. service_role stays the Square and desk-server path.

CREATE OR REPLACE FUNCTION public.protect_lead_desk_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  jwt_role text;
BEGIN
  jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  );
  IF jwt_role IS NULL OR jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.lifecycle = 'Paid'::public.lead_lifecycle
     AND (
       TG_OP = 'INSERT'
       OR OLD.lifecycle IS DISTINCT FROM 'Paid'::public.lead_lifecycle
     ) THEN
    RAISE EXCEPTION 'Only the system payment path may mark a lead Paid'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.intake_path = 'desk'
     AND (TG_OP = 'INSERT' OR OLD.intake_path IS DISTINCT FROM 'desk') THEN
    RAISE EXCEPTION 'Desk leads are recorded by the shop desk'
      USING ERRCODE = '42501';
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.created_by IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'created_by is assigned by the shop desk'
      USING ERRCODE = '42501';
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.google_ads_call_id IS NOT NULL)
     OR (
       TG_OP = 'UPDATE'
       AND NEW.google_ads_call_id IS DISTINCT FROM OLD.google_ads_call_id
     ) THEN
    RAISE EXCEPTION 'Google Ads call links are assigned by the shop desk'
      USING ERRCODE = '42501';
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.desk_idempotency_key IS NOT NULL)
     OR (
       TG_OP = 'UPDATE'
       AND NEW.desk_idempotency_key IS DISTINCT FROM OLD.desk_idempotency_key
     ) THEN
    RAISE EXCEPTION 'Desk idempotency is assigned by the shop desk'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_lead_desk_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS leads_protect_desk_columns ON public.leads;
CREATE TRIGGER leads_protect_desk_columns
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.protect_lead_desk_columns();
