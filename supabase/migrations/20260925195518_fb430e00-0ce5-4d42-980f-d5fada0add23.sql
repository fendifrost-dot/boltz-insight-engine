-- Meta (Facebook/Instagram) Lead Ads ingestion.
-- One row per Meta lead (meta_lead_id is the dedupe key); the Boltz lead it
-- normalizes into stays in public.leads. Raw Meta data is preserved verbatim.
-- Idempotent.

DO $$ BEGIN
  CREATE TYPE public.lead_ingestion_method AS ENUM (
  'WEBHOOK',
  'RECONCILIATION',
  'MANUAL_IMPORT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.meta_ingest_status AS ENUM (
  'received',
  'ingested',
  'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Grok first-touch runs on the shared lead-inbox queue. Ingestion itself does
-- not, so it never waits behind the xAI circuit breaker. The value is unused in
-- this migration, so ADD VALUE is safe inside the editor's transaction.
ALTER TYPE public.message_job_type ADD VALUE IF NOT EXISTS 'process_meta_lead';

CREATE TABLE IF NOT EXISTS public.meta_lead_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  meta_lead_id text NOT NULL,
  lead_id uuid NULL REFERENCES public.leads (id) ON DELETE SET NULL,
  ingestion_method public.lead_ingestion_method NOT NULL,
  ingest_status public.meta_ingest_status NOT NULL DEFAULT 'received',
  platform text NULL,
  is_organic boolean NULL,
  page_id text NULL,
  form_id text NULL,
  form_name text NULL,
  ad_id text NULL,
  ad_name text NULL,
  adset_id text NULL,
  adset_name text NULL,
  campaign_id text NULL,
  campaign_name text NULL,
  created_time timestamptz NULL,
  raw_field_data jsonb NULL,
  normalized_fields jsonb NULL,
  consent_evidence jsonb NULL,
  consent_text text NULL,
  consent_version text NULL,
  webhook_payload jsonb NULL,
  webhook_received_at timestamptz NULL,
  graph_fetched_at timestamptz NULL,
  ingested_at timestamptz NULL,
  grok_enqueued_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  CONSTRAINT meta_lead_submissions_meta_lead_id_unique UNIQUE (meta_lead_id),
  CONSTRAINT meta_lead_submissions_platform_check CHECK (
    platform IS NULL OR platform IN ('facebook', 'instagram')
  ),
  CONSTRAINT meta_lead_submissions_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS meta_lead_submissions_lead_id_idx
  ON public.meta_lead_submissions (lead_id);
CREATE INDEX IF NOT EXISTS meta_lead_submissions_status_idx
  ON public.meta_lead_submissions (ingest_status);
CREATE INDEX IF NOT EXISTS meta_lead_submissions_created_time_idx
  ON public.meta_lead_submissions (created_time DESC NULLS LAST);

DROP TRIGGER IF EXISTS meta_lead_submissions_set_updated_at ON public.meta_lead_submissions;
CREATE TRIGGER meta_lead_submissions_set_updated_at
  BEFORE UPDATE ON public.meta_lead_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.meta_lead_submissions ENABLE ROW LEVEL SECURITY;

-- Staff read; all writes go through the service-role ingestion path.
DROP POLICY IF EXISTS "meta_lead_submissions_staff_select" ON public.meta_lead_submissions;
CREATE POLICY "meta_lead_submissions_staff_select" ON public.meta_lead_submissions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

GRANT SELECT ON public.meta_lead_submissions TO authenticated;
GRANT ALL ON public.meta_lead_submissions TO service_role;
REVOKE ALL ON public.meta_lead_submissions FROM anon;