-- Harden outbound reservations: lease generation fencing, no automatic retry after uncertain sends.

ALTER TABLE public.outbound_send_reservations
  ADD COLUMN IF NOT EXISTS claim_generation integer NOT NULL DEFAULT 0;

ALTER TABLE public.outbound_send_reservations
  ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT false;

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
  _next_generation integer;
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
      'reason', COALESCE(_reservation.last_error, 'Prior send outcome ambiguous; requires human review')
    );
  END IF;

  IF _reservation.status = 'sending'
    AND _reservation.locked_at IS NOT NULL
    AND _reservation.locked_at < _lease_cutoff THEN
    UPDATE public.outbound_send_reservations
    SET
      status = 'ambiguous',
      locked_at = NULL,
      retryable = false,
      last_error = LEFT(
        COALESCE(last_error, '') ||
        CASE WHEN last_error IS NULL OR last_error = '' THEN '' ELSE '; ' END ||
        'Expired sending lease; provider outcome unknown',
        600
      )
    WHERE idempotency_key = _idempotency_key
      AND status = 'sending';

    RETURN jsonb_build_object(
      'action', 'review',
      'status', 'ambiguous',
      'reservation_id', _reservation.id,
      'reason', 'Expired sending lease; provider outcome unknown'
    );
  END IF;

  IF _reservation.status = 'sending' THEN
    RETURN jsonb_build_object(
      'action', 'skip',
      'status', 'sending',
      'reservation_id', _reservation.id,
      'reason', 'Another worker holds the outbound reservation'
    );
  END IF;

  IF _reservation.status = 'failed' AND NOT _reservation.retryable THEN
    RETURN jsonb_build_object(
      'action', 'review',
      'status', 'failed',
      'reservation_id', _reservation.id,
      'reason', COALESCE(_reservation.last_error, 'Prior send failure requires human review before retry')
    );
  END IF;

  UPDATE public.outbound_send_reservations
  SET
    status = 'sending',
    locked_at = _now,
    claim_generation = claim_generation + 1,
    retryable = false,
    last_error = NULL
  WHERE idempotency_key = _idempotency_key
    AND (
      status = 'queued'
      OR (status = 'failed' AND retryable = true)
    );
  GET DIAGNOSTICS _claimed = ROW_COUNT;

  IF _claimed = 0 THEN
    SELECT *
    INTO _reservation
    FROM public.outbound_send_reservations
    WHERE idempotency_key = _idempotency_key;

    RETURN jsonb_build_object(
      'action', 'review',
      'status', _reservation.status,
      'reservation_id', _reservation.id,
      'reason', 'Outbound reservation is not claimable'
    );
  END IF;

  SELECT claim_generation
  INTO _next_generation
  FROM public.outbound_send_reservations
  WHERE idempotency_key = _idempotency_key;

  RETURN jsonb_build_object(
    'action', 'send',
    'status', 'sending',
    'reservation_id', _reservation.id,
    'claim_generation', _next_generation
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_outbound_send(
  _idempotency_key text,
  _expected_claim_generation integer,
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
    last_error = NULL,
    retryable = false
  WHERE idempotency_key = _idempotency_key
    AND status = 'sending'
    AND claim_generation = _expected_claim_generation;
  GET DIAGNOSTICS _updated = ROW_COUNT;

  IF _updated = 0 THEN
    RETURN jsonb_build_object('status', 'lost_reservation');
  END IF;

  RETURN jsonb_build_object('status', 'sent');
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_outbound_send(
  _idempotency_key text,
  _expected_claim_generation integer,
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
    retryable = true,
    last_error = LEFT(COALESCE(_error, 'send failed'), 600)
  WHERE idempotency_key = _idempotency_key
    AND status = 'sending'
    AND claim_generation = _expected_claim_generation;
  GET DIAGNOSTICS _updated = ROW_COUNT;

  IF _updated = 0 THEN
    RETURN jsonb_build_object('status', 'lost_reservation');
  END IF;

  RETURN jsonb_build_object('status', 'failed');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_outbound_send_ambiguous(
  _idempotency_key text,
  _expected_claim_generation integer,
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
    retryable = false,
    provider_message_id = COALESCE(_provider_message_id, provider_message_id),
    last_error = LEFT(COALESCE(_detail, 'ambiguous provider outcome'), 600)
  WHERE idempotency_key = _idempotency_key
    AND status = 'sending'
    AND claim_generation = _expected_claim_generation;
  GET DIAGNOSTICS _updated = ROW_COUNT;

  IF _updated = 0 THEN
    RETURN jsonb_build_object('status', 'lost_reservation');
  END IF;

  RETURN jsonb_build_object('status', 'ambiguous');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_outbound_send(text, uuid, uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_outbound_send(text, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_outbound_send(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_outbound_send_ambiguous(text, integer, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_outbound_send(text, uuid, uuid, uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_outbound_send(text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_outbound_send(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbound_send_ambiguous(text, integer, text, text) TO service_role;
