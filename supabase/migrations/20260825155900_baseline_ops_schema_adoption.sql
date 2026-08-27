-- Boltz Operations OS schema baseline (additive adoption migration).
-- Captures production lead-inbox + auth objects for reproducibility.
-- Safe on: empty database (creates objects) and existing production (IF NOT EXISTS / OR REPLACE).
-- Does NOT drop or recreate live tables. Manual rollout only — do not auto-deploy.

-- Lead inbox foundation for RingCentral SMS + Grok.
-- Preserves null-for-unknown conventions used by SEO/GEO ops.
-- Does not alter existing SEO/GEO browser datasets.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------


  DO $$ BEGIN
    CREATE TYPE public.lead_lifecycle AS ENUM (
'New',
'Contacted',
'Qualified',
'Appointment Scheduled',
'Inspected',
'Estimate Sent',
'Approved',
'In Progress',
'Completed',
'Paid',
'Lost',
'No response',
'No-show',
'Duplicate',
'Spam',
'Outside service capability'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;


  DO $$ BEGIN
    CREATE TYPE public.consent_status AS ENUM (
'unknown',
'opted_in',
'opted_out'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

CREATE TYPE public.message_direction AS ENUM ('inbound', 'outbound');

CREATE TYPE public.message_channel AS ENUM ('SMS', 'MMS');


  DO $$ BEGIN
    CREATE TYPE public.message_delivery_state AS ENUM (
'queued',
'sending',
'sent',
'delivered',
'failed',
'received'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

CREATE TYPE public.thread_control_mode AS ENUM ('auto', 'human');


  DO $$ BEGIN
    CREATE TYPE public.message_job_type AS ENUM (
'process_inbound',
'send_outbound',
'reconcile',
'renew_subscription'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;


  DO $$ BEGIN
    CREATE TYPE public.message_job_status AS ENUM (
'pending',
'processing',
'succeeded',
'failed',
'dead'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

CREATE TYPE public.agent_action AS ENUM ('send', 'escalate', 'no_reply');


  DO $$ BEGIN
    CREATE TYPE public.escalation_category AS ENUM (
'threat',
'injury',
'legal_claim',
'insurance_liability',
'payment_dispute',
'harassment',
'unsupported_discount',
'human_requested',
'other_high_risk'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;


  DO $$ BEGIN
    CREATE TYPE public.escalation_status AS ENUM (
'open',
'acknowledged',
'resolved'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;


  DO $$ BEGIN
    CREATE TYPE public.sms_capability AS ENUM (
'SmsSender',
'A2PSmsSender',
'none',
'unknown'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name text NULL,
  phone_e164 text NULL,
  email text NULL,
  vehicle_year integer NULL,
  vehicle_make text NULL,
  vehicle_model text NULL,
  vehicle_mileage integer NULL,
  vin text NULL,
  symptoms text NULL,
  photo_urls jsonb NULL,
  attachment_urls jsonb NULL,
  lead_source text NULL,
  consent_status public.consent_status NOT NULL DEFAULT 'unknown',
  consent_evidence jsonb NULL,
  consent_updated_at timestamptz NULL,
  assigned_owner text NULL,
  follow_up_at timestamptz NULL,
  notes text NULL,
  lifecycle public.lead_lifecycle NOT NULL DEFAULT 'New',
  unread_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NULL,
  last_inbound_at timestamptz NULL,
  last_outbound_at timestamptz NULL,
  CONSTRAINT leads_phone_e164_format CHECK (
    phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT leads_unread_nonnegative CHECK (unread_count >= 0),
  CONSTRAINT leads_vehicle_year_range CHECK (
    vehicle_year IS NULL OR (vehicle_year >= 1900 AND vehicle_year <= 2100)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_e164_unique
  ON public.leads (phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_lifecycle_idx ON public.leads (lifecycle);
CREATE INDEX IF NOT EXISTS leads_follow_up_at_idx ON public.leads (follow_up_at);
CREATE INDEX IF NOT EXISTS leads_last_message_at_idx ON public.leads (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS leads_source_idx ON public.leads (lead_source);

CREATE TABLE IF NOT EXISTS public.lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_lifecycle public.lead_lifecycle NULL,
  to_lifecycle public.lead_lifecycle NULL,
  actor text NULL,
  summary text NULL,
  metadata jsonb NULL
);

CREATE INDEX IF NOT EXISTS lead_events_lead_id_created_at_idx
  ON public.lead_events (lead_id, created_at);

-- Append-only: block UPDATE/DELETE via trigger
CREATE OR REPLACE FUNCTION public.deny_lead_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead_events is append-only';
END;
$$;

CREATE TRIGGER lead_events_no_update
  BEFORE UPDATE ON public.lead_events
  FOR EACH ROW EXECUTE FUNCTION public.deny_lead_event_mutation();

CREATE TRIGGER lead_events_no_delete
  BEFORE DELETE ON public.lead_events
  FOR EACH ROW EXECUTE FUNCTION public.deny_lead_event_mutation();

CREATE TABLE IF NOT EXISTS public.message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  control_mode public.thread_control_mode NOT NULL DEFAULT 'auto',
  subject text NULL,
  last_message_at timestamptz NULL,
  unread_count integer NOT NULL DEFAULT 0,
  CONSTRAINT message_threads_phone_e164_format CHECK (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT message_threads_unread_nonnegative CHECK (unread_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS message_threads_lead_phone_unique
  ON public.message_threads (lead_id, phone_e164);

CREATE INDEX IF NOT EXISTS message_threads_control_mode_idx ON public.message_threads (control_mode);
CREATE INDEX IF NOT EXISTS message_threads_last_message_at_idx
  ON public.message_threads (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  thread_id uuid NOT NULL REFERENCES public.message_threads (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  direction public.message_direction NOT NULL,
  provider text NOT NULL DEFAULT 'ringcentral',
  provider_message_id text NULL,
  sender_e164 text NULL,
  recipients_e164 text[] NULL,
  body text NULL,
  channel public.message_channel NOT NULL DEFAULT 'SMS',
  delivery_state public.message_delivery_state NOT NULL DEFAULT 'queued',
  provider_created_at timestamptz NULL,
  provider_updated_at timestamptz NULL,
  error_code text NULL,
  error_message text NULL,
  attachment_urls jsonb NULL,
  provider_metadata_redacted jsonb NULL,
  idempotency_key text NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_unique
  ON public.messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_unique
  ON public.messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_thread_id_created_at_idx
  ON public.messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS messages_lead_id_created_at_idx
  ON public.messages (lead_id, created_at);
CREATE INDEX IF NOT EXISTS messages_delivery_state_idx ON public.messages (delivery_state);

CREATE TABLE IF NOT EXISTS public.message_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  job_type public.message_job_type NOT NULL,
  status public.message_job_status NOT NULL DEFAULT 'pending',
  lead_id uuid NULL REFERENCES public.leads (id) ON DELETE SET NULL,
  thread_id uuid NULL REFERENCES public.message_threads (id) ON DELETE SET NULL,
  message_id uuid NULL REFERENCES public.messages (id) ON DELETE SET NULL,
  inbound_provider_message_id text NULL,
  payload jsonb NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  last_error text NULL,
  completed_at timestamptz NULL,
  CONSTRAINT message_jobs_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS message_jobs_inbound_provider_unique
  ON public.message_jobs (job_type, inbound_provider_message_id)
  WHERE inbound_provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_jobs_pending_idx
  ON public.message_jobs (status, run_after)
  WHERE status = ANY (ARRAY['pending'::public.message_job_status, 'failed'::public.message_job_status]);

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NULL REFERENCES public.leads (id) ON DELETE SET NULL,
  thread_id uuid NULL REFERENCES public.message_threads (id) ON DELETE SET NULL,
  inbound_message_id uuid NULL REFERENCES public.messages (id) ON DELETE SET NULL,
  outbound_message_id uuid NULL REFERENCES public.messages (id) ON DELETE SET NULL,
  prompt_version text NOT NULL,
  model text NOT NULL,
  action public.agent_action NOT NULL,
  policy_tags text[] NULL,
  audit_summary text NULL,
  proposed_lifecycle public.lead_lifecycle NULL,
  lead_field_updates jsonb NULL,
  escalation_category public.escalation_category NULL,
  raw_decision jsonb NULL,
  CONSTRAINT agent_runs_no_chain_of_thought CHECK (
    raw_decision IS NULL OR NOT (raw_decision ? 'reasoning' OR raw_decision ? 'chain_of_thought' OR raw_decision ? 'thinking')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_inbound_message_unique
  ON public.agent_runs (inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runs_thread_id_created_at_idx
  ON public.agent_runs (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.message_threads (id) ON DELETE CASCADE,
  agent_run_id uuid NULL REFERENCES public.agent_runs (id) ON DELETE SET NULL,
  category public.escalation_category NOT NULL,
  reason text NOT NULL,
  status public.escalation_status NOT NULL DEFAULT 'open',
  resolved_at timestamptz NULL,
  resolution_notes text NULL
);

CREATE INDEX IF NOT EXISTS escalations_status_idx ON public.escalations (status);
CREATE INDEX IF NOT EXISTS escalations_lead_id_idx ON public.escalations (lead_id);

CREATE TABLE IF NOT EXISTS public.ringcentral_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider_subscription_id text NOT NULL,
  event_filters text[] NOT NULL,
  delivery_address text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NULL,
  last_renewed_at timestamptz NULL,
  last_renewal_error text NULL,
  last_notification_at timestamptz NULL,
  sms_capability public.sms_capability NOT NULL DEFAULT 'unknown',
  from_number_e164 text NULL,
  extension_id text NULL,
  metadata_redacted jsonb NULL,
  CONSTRAINT ringcentral_subscriptions_provider_id_unique UNIQUE (provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS ringcentral_subscriptions_expires_at_idx
  ON public.ringcentral_subscriptions (expires_at);

CREATE TABLE IF NOT EXISTS public.integration_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  check_name text NOT NULL,
  ok boolean NOT NULL,
  detail text NULL,
  metadata_redacted jsonb NULL
);

CREATE INDEX IF NOT EXISTS integration_health_snapshots_created_at_idx
  ON public.integration_health_snapshots (created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER message_threads_set_updated_at
  BEFORE UPDATE ON public.message_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER message_jobs_set_updated_at
  BEFORE UPDATE ON public.message_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER escalations_set_updated_at
  BEFORE UPDATE ON public.escalations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER ringcentral_subscriptions_set_updated_at
  BEFORE UPDATE ON public.ringcentral_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Auth helpers (must exist before staff/owner RLS policies)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('owner', 'staff')
  );
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_first_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_bootstrap_owner ON auth.users;
CREATE TRIGGER on_auth_user_created_bootstrap_owner
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_first_owner();

-- ---------------------------------------------------------------------------
-- Row Level Security — staff/owner portal (production baseline)
-- ---------------------------------------------------------------------------

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ringcentral_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_health_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop legacy permissive policies if present (safe on production adoption)
DROP POLICY IF EXISTS leads_authenticated_all ON public.leads;
DROP POLICY IF EXISTS lead_events_authenticated_select ON public.lead_events;
DROP POLICY IF EXISTS lead_events_authenticated_insert ON public.lead_events;
DROP POLICY IF EXISTS message_threads_authenticated_all ON public.message_threads;
DROP POLICY IF EXISTS messages_authenticated_all ON public.messages;
DROP POLICY IF EXISTS message_jobs_authenticated_select ON public.message_jobs;
DROP POLICY IF EXISTS message_jobs_authenticated_update ON public.message_jobs;
DROP POLICY IF EXISTS agent_runs_authenticated_select ON public.agent_runs;
DROP POLICY IF EXISTS escalations_authenticated_all ON public.escalations;
DROP POLICY IF EXISTS ringcentral_subscriptions_authenticated_select ON public.ringcentral_subscriptions;
DROP POLICY IF EXISTS integration_health_authenticated_select ON public.integration_health_snapshots;

DROP POLICY IF EXISTS agent_runs_staff_select ON public.agent_runs;
CREATE POLICY agent_runs_staff_select ON public.agent_runs
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS escalations_staff_all ON public.escalations;
CREATE POLICY escalations_staff_all ON public.escalations
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS integration_health_owner_select ON public.integration_health_snapshots;
CREATE POLICY integration_health_owner_select ON public.integration_health_snapshots
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS lead_events_staff_select ON public.lead_events;
CREATE POLICY lead_events_staff_select ON public.lead_events
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS lead_events_staff_insert ON public.lead_events;
CREATE POLICY lead_events_staff_insert ON public.lead_events
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS leads_staff_all ON public.leads;
CREATE POLICY leads_staff_all ON public.leads
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS message_jobs_staff_select ON public.message_jobs;
CREATE POLICY message_jobs_staff_select ON public.message_jobs
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS message_jobs_staff_update ON public.message_jobs;
CREATE POLICY message_jobs_staff_update ON public.message_jobs
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS message_threads_staff_all ON public.message_threads;
CREATE POLICY message_threads_staff_all ON public.message_threads
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS messages_staff_all ON public.messages;
CREATE POLICY messages_staff_all ON public.messages
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS ringcentral_subscriptions_owner_select ON public.ringcentral_subscriptions;
CREATE POLICY ringcentral_subscriptions_owner_select ON public.ringcentral_subscriptions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS user_roles_self_select ON public.user_roles;
CREATE POLICY user_roles_self_select ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'owner'));

-- ---------------------------------------------------------------------------
-- Grants (matches production + later incremental migrations)
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.leads FROM anon;
REVOKE ALL ON public.lead_events FROM anon;
REVOKE ALL ON public.message_threads FROM anon;
REVOKE ALL ON public.messages FROM anon;
REVOKE ALL ON public.message_jobs FROM anon;
REVOKE ALL ON public.agent_runs FROM anon;
REVOKE ALL ON public.escalations FROM anon;
REVOKE ALL ON public.ringcentral_subscriptions FROM anon;
REVOKE ALL ON public.integration_health_snapshots FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_threads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalations TO authenticated;
GRANT SELECT, INSERT ON public.lead_events TO authenticated;
GRANT SELECT, UPDATE ON public.message_jobs TO authenticated;
GRANT SELECT ON public.agent_runs TO authenticated;
GRANT SELECT ON public.ringcentral_subscriptions TO authenticated;
GRANT SELECT ON public.integration_health_snapshots TO authenticated;

GRANT ALL ON public.leads TO service_role;
GRANT ALL ON public.lead_events TO service_role;
GRANT ALL ON public.message_threads TO service_role;
GRANT ALL ON public.messages TO service_role;
GRANT ALL ON public.message_jobs TO service_role;
GRANT ALL ON public.agent_runs TO service_role;
GRANT ALL ON public.escalations TO service_role;
GRANT ALL ON public.ringcentral_subscriptions TO service_role;
GRANT ALL ON public.integration_health_snapshots TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
