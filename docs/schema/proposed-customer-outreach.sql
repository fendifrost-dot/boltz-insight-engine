-- PROPOSAL ONLY. Not a Supabase migration.
-- Do not copy this file into supabase/migrations/ until the owner signs off
-- and a later PR is explicitly authorized to create outreach tables.
-- Applying this SQL would still not text anyone; there is no send job attached.
--
-- See docs/proposals/2026-09-03-maintenance-reminders-and-checkins.md

-- ---------------------------------------------------------------------------
-- Square sync watermark
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.square_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  ok boolean NOT NULL DEFAULT false,
  watermark_updated_at timestamptz NULL,
  orders_seen integer NOT NULL DEFAULT 0,
  lines_classified integer NOT NULL DEFAULT 0,
  lines_needs_review integer NOT NULL DEFAULT 0,
  error text NULL
);

-- Advance the live watermark only from a row where ok = true.

-- ---------------------------------------------------------------------------
-- Square copies (our tables, not live Square)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.square_customers (
  square_customer_id text PRIMARY KEY,
  given_name text NULL,
  family_name text NULL,
  company_name text NULL,
  phone_e164 text NULL,
  email text NULL,
  raw_updated_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT square_customers_phone_e164_format CHECK (
    phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  )
);

CREATE TABLE IF NOT EXISTS public.square_orders (
  square_order_id text PRIMARY KEY,
  square_customer_id text NULL REFERENCES public.square_customers (square_customer_id),
  closed_at timestamptz NULL,
  state text NULL,
  invoice_id text NULL,
  total_cents integer NULL,
  source text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.square_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_order_id text NOT NULL REFERENCES public.square_orders (square_order_id) ON DELETE CASCADE,
  line_uid text NOT NULL,
  item_name text NULL,
  note text NULL,
  category text NULL,
  quantity numeric NULL,
  parse_status text NOT NULL DEFAULT 'needs_review',
  reminder_kind text NULL,
  vehicle_year integer NULL,
  vehicle_make text NULL,
  vehicle_model text NULL,
  vehicle_key text NULL,
  exclude_reason text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT square_order_lines_parse_status CHECK (
    parse_status IN ('classified', 'excluded', 'needs_review')
  ),
  CONSTRAINT square_order_lines_reminder_kind CHECK (
    reminder_kind IS NULL OR reminder_kind IN ('oil', 'brakes', 'battery', 'trans_fluid', 'none')
  ),
  CONSTRAINT square_order_lines_order_line_unique UNIQUE (square_order_id, line_uid)
);

-- Human review for lines the parser will not silently drop.
CREATE TABLE IF NOT EXISTS public.square_line_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  square_order_line_id uuid NOT NULL UNIQUE REFERENCES public.square_order_lines (id) ON DELETE CASCADE,
  item_name text NULL,
  note text NULL,
  suggested_kind text NULL,
  suggested_vehicle text NULL,
  resolution text NOT NULL DEFAULT 'pending',
  resolved_by text NULL,
  resolved_at timestamptz NULL,
  CONSTRAINT square_line_reviews_resolution CHECK (
    resolution IN ('pending', 'keep', 'exclude', 'attach_vehicle')
  )
);

-- ---------------------------------------------------------------------------
-- Due facts — unique per person + reason + originating Square job + vehicle
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.service_due_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  phone_e164 text NOT NULL,
  lead_id uuid NULL REFERENCES public.leads (id) ON DELETE SET NULL,
  reminder_kind text NOT NULL,
  vehicle_key text NOT NULL DEFAULT 'unknown',
  vehicle_label text NULL,
  source_order_id text NOT NULL,
  source_line_id uuid NULL REFERENCES public.square_order_lines (id) ON DELETE SET NULL,
  service_on date NOT NULL,
  due_on date NOT NULL,
  CONSTRAINT service_due_items_phone_format CHECK (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT service_due_items_kind CHECK (
    reminder_kind IN ('oil', 'brakes', 'battery', 'trans_fluid')
  ),
  CONSTRAINT service_due_items_occurrence_unique
    UNIQUE (phone_e164, reminder_kind, source_order_id, vehicle_key)
);

-- ---------------------------------------------------------------------------
-- Dated send queue — unique per person + campaign + wave + bundle
-- One approved/sending/sent row per phone per Chicago calendar date
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.outreach_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  phone_e164 text NOT NULL,
  lead_id uuid NULL REFERENCES public.leads (id) ON DELETE SET NULL,
  thread_id uuid NULL REFERENCES public.message_threads (id) ON DELETE SET NULL,
  campaign_kind text NOT NULL,
  wave text NOT NULL DEFAULT 'initial',
  bundle_key text NOT NULL,
  due_item_ids uuid[] NOT NULL DEFAULT '{}',
  reasons text[] NOT NULL DEFAULT '{}',
  scheduled_local_date date NOT NULL,
  run_after timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  skip_reason text NULL,
  body_preview text NULL,
  sent_at timestamptz NULL,
  message_id uuid NULL REFERENCES public.messages (id) ON DELETE SET NULL,
  CONSTRAINT outreach_queue_phone_format CHECK (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT outreach_queue_campaign CHECK (
    campaign_kind IN ('maintenance', 'check_in')
  ),
  CONSTRAINT outreach_queue_wave CHECK (
    wave IN ('initial', 'bump')
  ),
  CONSTRAINT outreach_queue_status CHECK (
    status IN (
      'draft',
      'approved',
      'sending',
      'sent',
      'skipped',
      'blocked_consent',
      'cancelled',
      'cancelled_opt_out',
      'failed'
    )
  ),
  CONSTRAINT outreach_queue_bundle_unique
    UNIQUE (phone_e164, campaign_kind, wave, bundle_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_one_text_per_phone_day
  ON public.outreach_queue (phone_e164, scheduled_local_date)
  WHERE status IN ('approved', 'sending', 'sent');

CREATE INDEX IF NOT EXISTS outreach_queue_drain_idx
  ON public.outreach_queue (status, run_after)
  WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS public.outreach_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  queue_id uuid NOT NULL REFERENCES public.outreach_queue (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor text NULL,
  summary text NULL,
  metadata jsonb NULL
);
