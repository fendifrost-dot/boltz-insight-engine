-- Square disputes (chargebacks). Read-only against Square.
-- The checklist and files live here. Nothing in this migration submits evidence to Square.
-- Browser roles cannot read these tables. service_role (server routes) is the only reader and writer.
-- Card data stays brand and last 4, copied from the linked payment. Do not add PAN, expiry, or fingerprint.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'square_sync_state'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%resource%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.square_sync_state DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.square_sync_state
  ADD CONSTRAINT square_sync_state_resource_check CHECK (
    resource IN (
      'payments',
      'refunds',
      'orders',
      'invoices',
      'customers',
      'catalog',
      'locations',
      'disputes'
    )
  );

CREATE TABLE IF NOT EXISTS public.square_disputes (
  square_id text PRIMARY KEY,
  payment_id text,
  location_id text,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  reason text NOT NULL,
  state text NOT NULL,
  card_brand text,
  card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  due_by timestamptz,
  brand_dispute_id text,
  square_version integer CHECK (square_version IS NULL OR square_version >= 0),
  reported_at timestamptz,
  customer_id text,
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (
    match_status IN ('exact_phone', 'exact_email', 'ambiguous', 'unmatched')
  ),
  matched_at timestamptz,
  created_at_square timestamptz,
  updated_at_square timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.square_disputes IS
  'Square Disputes API rows. due_by is Square due_at. lead_id and customer_id come from the linked payment. Evidence is not submitted back to Square.';
COMMENT ON COLUMN public.square_disputes.card_last4 IS
  'Copied from the linked square_payments row. Brand may also come from the dispute. Do not add PAN or expiry.';
COMMENT ON COLUMN public.square_disputes.due_by IS
  'Seller response deadline from Square due_at. Used for the 3-day alert.';

CREATE TABLE IF NOT EXISTS public.square_dispute_evidence (
  dispute_id text NOT NULL REFERENCES public.square_disputes (square_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN (
      'estimate_repair_approval',
      'invoice',
      'parts_receipt',
      'photos',
      'pickup_release',
      'customer_messages',
      'notes'
    )
  ),
  status text NOT NULL DEFAULT 'missing' CHECK (
    status IN ('missing', 'ready', 'not_applicable')
  ),
  link_url text CHECK (link_url IS NULL OR char_length(link_url) <= 2000),
  storage_path text,
  file_name text,
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dispute_id, kind)
);

COMMENT ON TABLE public.square_dispute_evidence IS
  'Internal evidence checklist. A resync does not reset status. Files stay in the private dispute-evidence bucket. Never sent to Square.';

CREATE INDEX IF NOT EXISTS square_disputes_due_idx
  ON public.square_disputes (due_by)
  WHERE due_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS square_disputes_payment_idx
  ON public.square_disputes (payment_id)
  WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS square_disputes_lead_idx
  ON public.square_disputes (lead_id)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS square_disputes_state_idx
  ON public.square_disputes (state);
CREATE INDEX IF NOT EXISTS square_payments_card_last4_idx
  ON public.square_payments (card_last4)
  WHERE card_last4 IS NOT NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['square_disputes', 'square_dispute_evidence']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- Private files for the checklist. No browser policies. Server routes sign a short-lived URL after integrations.manage.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dispute-evidence',
  'dispute-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;
