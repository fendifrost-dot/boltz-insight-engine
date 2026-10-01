-- Email and Google Ads lead intake receipts, plus the intake cron.
-- Idempotent. Writes no messages. Scheduling copies the existing cron bearer
-- and no-ops when pg_cron or that job is absent.

CREATE TABLE IF NOT EXISTS public.email_intake_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text NOT NULL,
  source text NOT NULL,
  external_id text NULL,
  lead_id uuid NULL REFERENCES public.leads (id) ON DELETE SET NULL,
  status text NOT NULL,
  received_at timestamptz NULL,
  suppress_first_touch boolean NOT NULL DEFAULT true,
  CONSTRAINT email_intake_receipts_provider_message_unique UNIQUE (provider_message_id),
  CONSTRAINT email_intake_receipts_status_check CHECK (
    status IN ('ingested', 'duplicate', 'skipped', 'failed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS email_intake_receipts_source_external_idx
  ON public.email_intake_receipts (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_intake_receipts_lead_id_idx
  ON public.email_intake_receipts (lead_id);

ALTER TABLE public.email_intake_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_intake_receipts_staff_select" ON public.email_intake_receipts;
CREATE POLICY "email_intake_receipts_staff_select" ON public.email_intake_receipts
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

GRANT SELECT ON public.email_intake_receipts TO authenticated;
GRANT ALL ON public.email_intake_receipts TO service_role;
REVOKE ALL ON public.email_intake_receipts FROM anon;

DO $$
DECLARE src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; lead-intake cron not scheduled';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'cron' AND table_name = 'job'
  ) THEN
    RAISE NOTICE 'cron.job missing; lead-intake cron not scheduled';
    RETURN;
  END IF;
  SELECT command INTO src
  FROM cron.job
  WHERE command LIKE '%/api/public/cron/reconcile-messages%'
  ORDER BY jobid
  LIMIT 1;
  IF src IS NULL THEN
    RAISE NOTICE 'no reconcile-messages cron to copy; lead-intake cron not scheduled';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'lead-intake',
    '*/10 * * * *',
    replace(
      src,
      '/api/public/cron/reconcile-messages',
      '/api/public/cron/ingest-leads'
    )
  );
END $$;
