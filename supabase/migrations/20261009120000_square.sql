-- Square read models for Boltz Insight Engine.
-- Payments, refunds, orders, invoices, customers, and catalog items are keyed by Square id
-- and upserted in place. Phone and email columns exist only so a payment can be matched
-- to a lead. Do not log them. Card data is limited to brand and last 4.
--
-- Browser roles cannot read these tables. RLS is forced. service_role (server routes)
-- bypasses RLS. There are no anon or authenticated policies.

CREATE TABLE IF NOT EXISTS public.square_sync_state (
  resource text PRIMARY KEY CHECK (
    resource IN ('payments', 'refunds', 'orders', 'invoices', 'customers', 'catalog', 'locations')
  ),
  cursor text,
  synced_through timestamptz,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_count integer NOT NULL DEFAULT 0 CHECK (last_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.square_sync_state IS
  'Per-resource Square sync cursor. last_error is a short code, never a payload or a customer field.';

CREATE TABLE IF NOT EXISTS public.square_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  object_id text,
  status text NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'processed', 'ignored', 'failed')
  ),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

COMMENT ON TABLE public.square_webhook_events IS
  'Square webhook event ids. The raw body is not stored. A repeated event id is a duplicate.';

CREATE TABLE IF NOT EXISTS public.square_customers (
  square_id text PRIMARY KEY,
  phone_e164 text,
  email text,
  created_at_square timestamptz,
  updated_at_square timestamptz,
  deleted_at timestamptz,
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (
    match_status IN ('exact_phone', 'exact_email', 'ambiguous', 'unmatched')
  ),
  matched_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.square_customers.phone_e164 IS
  'Normalized for lead matching only. Do not log.';
COMMENT ON COLUMN public.square_customers.email IS
  'Normalized for lead matching only. Do not log.';

CREATE TABLE IF NOT EXISTS public.square_payments (
  square_id text PRIMARY KEY,
  location_id text,
  customer_id text,
  order_id text,
  status text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  refunded_cents bigint NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  tip_cents bigint NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  source_type text,
  card_brand text,
  card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  buyer_phone_e164 text,
  buyer_email text,
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (
    match_status IN ('exact_phone', 'exact_email', 'ambiguous', 'unmatched')
  ),
  matched_at timestamptz,
  created_at_square timestamptz,
  updated_at_square timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.square_payments.buyer_phone_e164 IS
  'Normalized for lead matching only. Do not log.';
COMMENT ON COLUMN public.square_payments.buyer_email IS
  'Normalized for lead matching only. Do not log.';
COMMENT ON COLUMN public.square_payments.card_last4 IS
  'Non-sensitive card last 4. Do not add PAN or expiry columns.';

CREATE TABLE IF NOT EXISTS public.square_refunds (
  square_id text PRIMARY KEY,
  payment_id text,
  order_id text,
  location_id text,
  status text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  created_at_square timestamptz,
  updated_at_square timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.square_orders (
  square_id text PRIMARY KEY,
  location_id text,
  customer_id text,
  state text NOT NULL,
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (
    match_status IN ('exact_phone', 'exact_email', 'ambiguous', 'unmatched')
  ),
  matched_at timestamptz,
  created_at_square timestamptz,
  updated_at_square timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.square_order_line_items (
  order_square_id text NOT NULL REFERENCES public.square_orders (square_id) ON DELETE CASCADE,
  line_uid text NOT NULL,
  name text,
  quantity text,
  gross_cents bigint CHECK (gross_cents IS NULL OR gross_cents >= 0),
  catalog_object_id text,
  PRIMARY KEY (order_square_id, line_uid)
);

COMMENT ON COLUMN public.square_order_line_items.name IS
  'Catalog item name from the order. Not a customer name.';

CREATE TABLE IF NOT EXISTS public.square_invoices (
  square_id text PRIMARY KEY,
  order_id text,
  customer_id text,
  location_id text,
  status text NOT NULL,
  invoice_number text,
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  recipient_phone_e164 text,
  recipient_email text,
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (
    match_status IN ('exact_phone', 'exact_email', 'ambiguous', 'unmatched')
  ),
  matched_at timestamptz,
  created_at_square timestamptz,
  updated_at_square timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.square_invoices.recipient_phone_e164 IS
  'Normalized for lead matching only. Do not log.';
COMMENT ON COLUMN public.square_invoices.recipient_email IS
  'Normalized for lead matching only. Do not log.';

CREATE TABLE IF NOT EXISTS public.square_catalog_items (
  square_id text PRIMARY KEY,
  item_type text NOT NULL,
  name text,
  updated_at_square timestamptz,
  is_deleted boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS square_payments_created_idx
  ON public.square_payments (created_at_square DESC);
CREATE INDEX IF NOT EXISTS square_payments_lead_idx
  ON public.square_payments (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS square_payments_unmatched_idx
  ON public.square_payments (created_at_square DESC) WHERE lead_id IS NULL;
CREATE INDEX IF NOT EXISTS square_payments_customer_idx
  ON public.square_payments (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS square_customers_phone_idx
  ON public.square_customers (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS square_customers_email_idx
  ON public.square_customers (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS square_refunds_payment_idx
  ON public.square_refunds (payment_id);
CREATE INDEX IF NOT EXISTS square_refunds_created_idx
  ON public.square_refunds (created_at_square DESC);
CREATE INDEX IF NOT EXISTS square_orders_customer_idx
  ON public.square_orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS square_invoices_customer_idx
  ON public.square_invoices (customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS square_gross_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS square_net_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS square_paid_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_square_amounts_nonnegative'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_square_amounts_nonnegative
      CHECK (square_gross_cents >= 0 AND square_net_cents >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.leads.square_gross_cents IS
  'Sum of completed Square payments linked to this lead, in cents. Updated by the Square sync, not by agents.';
COMMENT ON COLUMN public.leads.square_net_cents IS
  'Linked completed Square payments minus refunds recorded on those payments, in cents.';

-- sales_weekly already exists in the hosted database (square_gross / stripe_gross).
-- Create it for a fresh migration run, then add the Square rollup columns.
CREATE TABLE IF NOT EXISTS public.sales_weekly (
  week_start date PRIMARY KEY,
  square_gross numeric,
  stripe_gross numeric,
  notes text,
  reported_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON COLUMN public.sales_weekly.square_gross IS
  'Completed Square payment gross for the Chicago Monday week, in dollars.';

ALTER TABLE public.sales_weekly
  ADD COLUMN IF NOT EXISTS square_net numeric,
  ADD COLUMN IF NOT EXISTS square_refunds numeric,
  ADD COLUMN IF NOT EXISTS square_ticket_count integer,
  ADD COLUMN IF NOT EXISTS square_avg_ticket numeric,
  ADD COLUMN IF NOT EXISTS square_attributed jsonb,
  ADD COLUMN IF NOT EXISTS square_synced_at timestamptz;

COMMENT ON COLUMN public.sales_weekly.square_net IS
  'Square gross minus Square refunds for the week, in dollars. Refunds are cash-basis.';
COMMENT ON COLUMN public.sales_weekly.square_refunds IS
  'Completed Square refunds created in the week, in dollars.';
COMMENT ON COLUMN public.sales_weekly.square_attributed IS
  'Lead-attributed completed Square gross by lead_source, in dollars. A blank source is stored as unknown.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
    WHERE n.nspname = 'public'
      AND c.relname = 'sales_weekly'
      AND i.indisunique
      AND a.attname = 'week_start'
      AND i.indnkeyatts = 1
  ) THEN
    CREATE UNIQUE INDEX sales_weekly_week_start_uidx ON public.sales_weekly (week_start);
  END IF;
END $$;

-- Monday-start weeks in America/Chicago.
-- gross: completed payments created that week.
-- refunds: completed refunds created that week (cash basis; a refund can land in a later week).
-- net: gross - refunds.
-- attributed_by_source: completed payment gross linked to a lead, grouped by lead_source.
CREATE OR REPLACE VIEW public.square_revenue_weekly
WITH (security_invoker = true) AS
WITH pay AS (
  SELECT
    p.amount_cents,
    p.lead_id,
    (
      (p.created_at_square AT TIME ZONE 'America/Chicago')::date
      - (EXTRACT(ISODOW FROM (p.created_at_square AT TIME ZONE 'America/Chicago'))::integer - 1)
    ) AS week_start
  FROM public.square_payments p
  WHERE p.status = 'COMPLETED' AND p.created_at_square IS NOT NULL
),
refunds AS (
  SELECT
    r.amount_cents,
    (
      (r.created_at_square AT TIME ZONE 'America/Chicago')::date
      - (EXTRACT(ISODOW FROM (r.created_at_square AT TIME ZONE 'America/Chicago'))::integer - 1)
    ) AS week_start
  FROM public.square_refunds r
  WHERE r.status = 'COMPLETED' AND r.created_at_square IS NOT NULL
),
pay_weeks AS (
  SELECT week_start, SUM(amount_cents)::bigint AS gross_cents, COUNT(*)::integer AS ticket_count
  FROM pay
  GROUP BY week_start
),
refund_weeks AS (
  SELECT week_start, SUM(amount_cents)::bigint AS refund_cents
  FROM refunds
  GROUP BY week_start
),
weeks AS (
  SELECT week_start FROM pay_weeks
  UNION
  SELECT week_start FROM refund_weeks
),
attr AS (
  SELECT
    pay.week_start,
    COALESCE(NULLIF(l.lead_source, ''), 'unknown') AS source,
    SUM(pay.amount_cents)::bigint AS gross_cents
  FROM pay
  JOIN public.leads l ON l.id = pay.lead_id
  GROUP BY pay.week_start, COALESCE(NULLIF(l.lead_source, ''), 'unknown')
),
attr_json AS (
  SELECT week_start, jsonb_object_agg(source, gross_cents) AS attributed_by_source
  FROM attr
  GROUP BY week_start
)
SELECT
  w.week_start,
  COALESCE(pw.gross_cents, 0)::bigint AS gross_cents,
  COALESCE(rw.refund_cents, 0)::bigint AS refund_cents,
  (COALESCE(pw.gross_cents, 0) - COALESCE(rw.refund_cents, 0))::bigint AS net_cents,
  COALESCE(pw.ticket_count, 0)::integer AS ticket_count,
  CASE
    WHEN COALESCE(pw.ticket_count, 0) = 0 THEN 0
    ELSE (pw.gross_cents / pw.ticket_count)::bigint
  END AS avg_ticket_cents,
  COALESCE(aj.attributed_by_source, '{}'::jsonb) AS attributed_by_source
FROM weeks w
LEFT JOIN pay_weeks pw ON pw.week_start = w.week_start
LEFT JOIN refund_weeks rw ON rw.week_start = w.week_start
LEFT JOIN attr_json aj ON aj.week_start = w.week_start;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'square_sync_state',
    'square_webhook_events',
    'square_customers',
    'square_payments',
    'square_refunds',
    'square_orders',
    'square_order_line_items',
    'square_invoices',
    'square_catalog_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

REVOKE ALL ON public.square_revenue_weekly FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.square_revenue_weekly TO service_role;
