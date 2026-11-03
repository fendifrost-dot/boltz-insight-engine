-- Additive ingestion methods for Make.com and Meta lead-notification email.
-- Does not rewrite existing rows. Safe to re-run.
-- Apply in the Lovable SQL editor after this migration is on main.
-- MAKE and EMAIL are not used in this file, so ADD VALUE is safe in a transaction.

ALTER TYPE public.lead_ingestion_method ADD VALUE IF NOT EXISTS 'MAKE';
ALTER TYPE public.lead_ingestion_method ADD VALUE IF NOT EXISTS 'EMAIL';
