-- Recovery for message_jobs left in processing, plus a queue category for
-- inbound SMS stored without an automated reply.
-- The new enum value is not used in this migration, so ADD VALUE is safe
-- inside the editor's transaction.

CREATE INDEX IF NOT EXISTS message_jobs_processing_lease_idx
  ON public.message_jobs (locked_at)
  WHERE status = 'processing'::public.message_job_status;

ALTER TYPE public.escalation_category ADD VALUE IF NOT EXISTS 'stale_inbound';
