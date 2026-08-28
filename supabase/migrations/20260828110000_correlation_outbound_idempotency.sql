-- End-to-end correlation identity, atomic inbound job enqueue, and durable outbound reservations.

DO $$ BEGIN
  CREATE TYPE public.outbound_send_status AS ENUM (
    'queued',
    'sending',
    'sent',
    'failed',
    'ambiguous'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS correlation_id uuid NULL;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS correlation_id uuid NULL;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS correlation_id uuid NULL;

ALTER TABLE public.lead_events
  ADD COLUMN IF NOT EXISTS correlation_id uuid NULL;

CREATE INDEX IF NOT EXISTS message_jobs_correlation_id_idx
  ON public.message_jobs (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_correlation_id_idx
  ON public.messages (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runs_correlation_id_idx
  ON public.agent_runs (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lead_events_correlation_id_idx
  ON public.lead_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.outbound_send_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  correlation_id uuid NULL,
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.message_threads (id) ON DELETE CASCADE,
  recipient_e164 text NOT NULL,
  body_hash text NOT NULL,
  status public.outbound_send_status NOT NULL DEFAULT 'queued',
  locked_at timestamptz NULL,
  provider_message_id text NULL,
  message_id uuid NULL REFERENCES public.messages (id) ON DELETE SET NULL,
  last_error text NULL,
  sent_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS outbound_send_reservations_idempotency_key_unique
  ON public.outbound_send_reservations (idempotency_key);

CREATE INDEX IF NOT EXISTS outbound_send_reservations_status_idx
  ON public.outbound_send_reservations (status, locked_at);

DROP TRIGGER IF EXISTS outbound_send_reservations_set_updated_at ON public.outbound_send_reservations;
CREATE TRIGGER outbound_send_reservations_set_updated_at
  BEFORE UPDATE ON public.outbound_send_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.derive_inbound_correlation_id(
  _provider text,
  _provider_message_id text
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT (
    substr(h, 1, 8) || '-' ||
    substr(h, 9, 4) || '-' ||
    '4' || substr(h, 13, 3) || '-' ||
    substr('89ab', 1 + (get_byte(decode(substr(h, 17, 2), 'hex'), 0) % 4), 1) ||
    substr(h, 17, 3) || '-' ||
    substr(h, 21, 12)
  )::uuid
  FROM (SELECT md5(_provider || ':inbound:' || _provider_message_id) AS h) AS digest;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_inbound_message_job(
  _inbound_provider_message_id text,
  _payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _correlation_id uuid;
  _job public.message_jobs;
BEGIN
  IF _inbound_provider_message_id IS NULL OR btrim(_inbound_provider_message_id) = '' THEN
    RAISE EXCEPTION 'enqueue_inbound_message_job requires inbound_provider_message_id';
  END IF;

  _correlation_id := public.derive_inbound_correlation_id('ringcentral', _inbound_provider_message_id);

  INSERT INTO public.message_jobs (
    job_type,
    inbound_provider_message_id,
    correlation_id,
    payload,
    status,
    run_after
  )
  VALUES (
    'process_inbound',
    _inbound_provider_message_id,
    _correlation_id,
    COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('correlation_id', _correlation_id::text),
    'pending',
    now()
  )
  ON CONFLICT (job_type, inbound_provider_message_id)
  WHERE inbound_provider_message_id IS NOT NULL
  DO NOTHING
  RETURNING * INTO _job;

  IF _job.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'created', true,
      'job_id', _job.id,
      'correlation_id', _job.correlation_id,
      'status', _job.status
    );
  END IF;

  SELECT *
  INTO _job
  FROM public.message_jobs
  WHERE job_type = 'process_inbound'
    AND inbound_provider_message_id = _inbound_provider_message_id;

  RETURN jsonb_build_object(
    'created', false,
    'job_id', _job.id,
    'correlation_id', _job.correlation_id,
    'status', _job.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_outbound_send(
  _idempotency_key text,
  _correlation_id uuid,
  _lead_id uuid,
  _thread_id uuid,
  _recipient_e164 text,
  _body text,
  _lease_ms integer DEFAULT 120000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reservation public.outbound_send_reservations;
  _body_hash text;
  _lease_cutoff timestamptz;
  _now timestamptz := now();
  _claimed integer := 0;
BEGIN
  IF _idempotency_key IS NULL OR btrim(_idempotency_key) = '' THEN
    RAISE EXCEPTION 'reserve_outbound_send requires idempotency_key';
  END IF;

  IF _lease_ms IS NULL OR _lease_ms < 1000 OR _lease_ms > 3600000 THEN
    RAISE EXCEPTION 'reserve_outbound_send lease_ms must be between 1000 and 3600000, got %', _lease_ms;
  END IF;

  _body_hash := md5(COALESCE(_body, ''));
  _lease_cutoff := _now - (_lease_ms * interval '1 millisecond');

  INSERT INTO public.outbound_send_reservations (
    idempotency_key,
    correlation_id,
    lead_id,
    thread_id,
    recipient_e164,
    body_hash,
    status
  )
  VALUES (
    _idempotency_key,
    _correlation_id,
    _lead_id,
    _thread_id,
    _recipient_e164,
    _body_hash,
    'queued'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT *
  INTO _reservation
  FROM public.outbound_send_reservations
  WHERE idempotency_key = _idempotency_key;

  IF _reservation.body_hash <> _body_hash OR _reservation.recipient_e164 <> _recipient_e164 THEN
    RETURN jsonb_build_object(
      'action', 'review',
      'status', _reservation.status,
      'reservation_id', _reservation.id,
      'reason', 'Idempotency key reused with different recipient or body'
    );
  END IF;

  IF _reservation.status = 'sent' THEN
    RETURN jsonb_build_object(
      'action', 'skip',
      'status', 'sent',
      'reservation_id', _reservation.id,
      'message_id', _reservation.message_id,
      'provider_message_id', _reservation.provider_message_id
    );
  END IF;

  IF _reservation.status = 'ambiguous' THEN
    RETURN jsonb_build_object(
      'action', 'review',
      'status', 'ambiguous',
      'reservation_id', _reservation.id,
      'reason', 'Prior send outcome ambiguous; requires human review'
    );
  END IF;

  UPDATE public.outbound_send_reservations
  SET
    status = 'failed',
    locked_at = NULL,
    last_error = LEFT(
      COALESCE(last_error, '') || CASE WHEN last_error IS NULL OR last_error = '' THEN '' ELSE '; ' END ||
      'Recovered stale sending reservation',
      600
    )
  WHERE idempotency_key = _idempotency_key
    AND status = 'sending'
    AND locked_at IS NOT NULL
    AND locked_at < _lease_cutoff;

  UPDATE public.outbound_send_reservations
  SET
    status = 'sending',
    locked_at = _now,
    last_error = NULL
  WHERE idempotency_key = _idempotency_key
    AND status IN ('queued', 'failed')
    AND (locked_at IS NULL OR locked_at < _lease_cutoff);
  GET DIAGNOSTICS _claimed = ROW_COUNT;

  IF _claimed = 0 THEN
    SELECT *
    INTO _reservation
    FROM public.outbound_send_reservations
    WHERE idempotency_key = _idempotency_key;

    IF _reservation.status = 'sending' THEN
      RETURN jsonb_build_object(
        'action', 'skip',
        'status', 'sending',
        'reservation_id', _reservation.id,
        'reason', 'Another worker holds the outbound reservation'
      );
    END IF;

    IF _reservation.status = 'failed' THEN
      RETURN jsonb_build_object(
        'action', 'review',
        'status', 'failed',
        'reservation_id', _reservation.id,
        'reason', _reservation.last_error
      );
    END IF;
  END IF;

  SELECT *
  INTO _reservation
  FROM public.outbound_send_reservations
  WHERE idempotency_key = _idempotency_key;

  RETURN jsonb_build_object(
    'action', 'send',
    'status', _reservation.status,
    'reservation_id', _reservation.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_outbound_send(
  _idempotency_key text,
  _provider_message_id text,
  _message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated integer;
BEGIN
  UPDATE public.outbound_send_reservations
  SET
    status = 'sent',
    locked_at = NULL,
    provider_message_id = _provider_message_id,
    message_id = _message_id,
    sent_at = now(),
    last_error = NULL
  WHERE idempotency_key = _idempotency_key
    AND status = 'sending';
  GET DIAGNOSTICS _updated = ROW_COUNT;

  IF _updated = 0 THEN
    RETURN jsonb_build_object('status', 'lost_reservation');
  END IF;

  RETURN jsonb_build_object('status', 'sent');
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_outbound_send(
  _idempotency_key text,
  _error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated integer;
BEGIN
  UPDATE public.outbound_send_reservations
  SET
    status = 'failed',
    locked_at = NULL,
    last_error = LEFT(COALESCE(_error, 'send failed'), 600)
  WHERE idempotency_key = _idempotency_key
    AND status = 'sending';
  GET DIAGNOSTICS _updated = ROW_COUNT;

  IF _updated = 0 THEN
    RETURN jsonb_build_object('status', 'lost_reservation');
  END IF;

  RETURN jsonb_build_object('status', 'failed');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_outbound_send_ambiguous(
  _idempotency_key text,
  _provider_message_id text,
  _detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated integer;
BEGIN
  UPDATE public.outbound_send_reservations
  SET
    status = 'ambiguous',
    locked_at = NULL,
    provider_message_id = COALESCE(_provider_message_id, provider_message_id),
    last_error = LEFT(COALESCE(_detail, 'ambiguous provider outcome'), 600)
  WHERE idempotency_key = _idempotency_key
    AND status IN ('sending', 'sent');
  GET DIAGNOSTICS _updated = ROW_COUNT;

  IF _updated = 0 THEN
    RETURN jsonb_build_object('status', 'lost_reservation');
  END IF;

  RETURN jsonb_build_object('status', 'ambiguous');
END;
$$;

REVOKE ALL ON FUNCTION public.derive_inbound_correlation_id(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_inbound_message_job(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_outbound_send(text, uuid, uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_outbound_send(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_outbound_send(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_outbound_send_ambiguous(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.derive_inbound_correlation_id(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_inbound_message_job(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_outbound_send(text, uuid, uuid, uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_outbound_send(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_outbound_send(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbound_send_ambiguous(text, text, text) TO service_role;
