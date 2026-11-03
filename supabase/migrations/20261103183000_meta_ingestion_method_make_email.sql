-- Make.com and mailbox fallbacks record their own ingestion method.
-- Additive enum values only. They are not used in this migration, so
-- ADD VALUE is safe inside the editor's transaction.

ALTER TYPE public.lead_ingestion_method ADD VALUE IF NOT EXISTS 'MAKE';
ALTER TYPE public.lead_ingestion_method ADD VALUE IF NOT EXISTS 'EMAIL';
