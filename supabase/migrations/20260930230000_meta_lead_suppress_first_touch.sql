-- Lets a backfill mark a Meta lead so a later process_meta_lead job does not
-- send a first touch. Idempotent. Apply in the Lovable SQL editor before
-- invoking mode=backfill. Does not enqueue jobs or send messages.

ALTER TABLE public.meta_lead_submissions
  ADD COLUMN IF NOT EXISTS suppress_first_touch boolean NOT NULL DEFAULT false;
