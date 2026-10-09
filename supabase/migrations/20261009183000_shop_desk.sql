-- Shop desk: walk-in and phone leads recorded by staff into public.leads.
-- Shop assistants use the existing app_role 'staff' (is_staff). Owner remains owner.
--
-- ads_call_weekly stays counts and durations only. Caller numbers, when a
-- service-role job has them, live in google_ads_call_numbers so the desk can
-- match a phone lead without staff knowing the Ads account.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS intake_path text,
  ADD COLUMN IF NOT EXISTS intake_channel text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS heard_about text,
  ADD COLUMN IF NOT EXISTS appointment_interest boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS desk_idempotency_key text,
  ADD COLUMN IF NOT EXISTS google_ads_call_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_intake_path_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_intake_path_check
      CHECK (intake_path IS NULL OR intake_path = 'desk');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_intake_channel_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_intake_channel_check
      CHECK (intake_channel IS NULL OR intake_channel IN ('walk_in', 'phone'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_intake_channel_desk'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_intake_channel_desk
      CHECK (intake_channel IS NULL OR intake_path = 'desk');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_heard_about_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_heard_about_check
      CHECK (
        heard_about IS NULL
        OR heard_about IN (
          'google',
          'yelp',
          'facebook',
          'instagram',
          'referral',
          'returning',
          'drive_by',
          'other'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_desk_markers'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_desk_markers
      CHECK (
        intake_path IS DISTINCT FROM 'desk'
        OR (intake_channel IS NOT NULL AND heard_about IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_desk_idempotency_format'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_desk_idempotency_format
      CHECK (
        desk_idempotency_key IS NULL
        OR desk_idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_desk_idempotency_desk'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_desk_idempotency_desk
      CHECK (desk_idempotency_key IS NULL OR intake_path = 'desk');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_created_by_fkey'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS leads_desk_idempotency_key_unique
  ON public.leads (desk_idempotency_key)
  WHERE desk_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_desk_created_idx
  ON public.leads (created_at DESC)
  WHERE intake_path = 'desk';

COMMENT ON COLUMN public.leads.intake_path IS
  'desk when the shop desk created the row. Null for online intake.';
COMMENT ON COLUMN public.leads.intake_channel IS
  'walk_in or phone. Set only for desk leads.';
COMMENT ON COLUMN public.leads.created_by IS
  'Auth user id of the staff or owner who saved the desk lead.';
COMMENT ON COLUMN public.leads.heard_about IS
  'Desk pick-list key. Reporting still groups on lead_source.';
COMMENT ON COLUMN public.leads.desk_idempotency_key IS
  'Client retry key for one desk save. Not a customer identifier.';
COMMENT ON COLUMN public.leads.google_ads_call_id IS
  'Set when a desk phone lead matches google_ads_call_numbers. Not a caller dump.';

CREATE TABLE IF NOT EXISTS public.google_ads_call_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  phone_e164 text NOT NULL,
  started_at timestamptz NOT NULL,
  week_start date NOT NULL,
  customer_id text NOT NULL,
  ads_call_weekly_id uuid NULL REFERENCES public.ads_call_weekly (id) ON DELETE SET NULL,
  CONSTRAINT google_ads_call_numbers_phone_format CHECK (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT google_ads_call_numbers_customer_len CHECK (
    char_length(customer_id) BETWEEN 1 AND 32
  ),
  CONSTRAINT google_ads_call_numbers_phone_started_unique UNIQUE (phone_e164, started_at)
);

COMMENT ON TABLE public.google_ads_call_numbers IS
  'Google Ads caller numbers for desk matching. Service role only. Do not log phone_e164. ads_call_weekly remains aggregate counts.';

CREATE INDEX IF NOT EXISTS google_ads_call_numbers_phone_started_idx
  ON public.google_ads_call_numbers (phone_e164, started_at DESC);

CREATE INDEX IF NOT EXISTS google_ads_call_numbers_week_idx
  ON public.google_ads_call_numbers (week_start);

ALTER TABLE public.google_ads_call_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_call_numbers FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.google_ads_call_numbers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.google_ads_call_numbers TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_google_ads_call_id_fkey'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_google_ads_call_id_fkey
      FOREIGN KEY (google_ads_call_id) REFERENCES public.google_ads_call_numbers (id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Browser roles keep their existing lead grants. They cannot mark Paid, forge
-- desk markers, or attach an Ads call. Square and the desk server use service_role.
CREATE OR REPLACE FUNCTION public.protect_lead_desk_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  jwt_role text;
BEGIN
  jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
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
