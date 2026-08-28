-- Atomic lead lifecycle transition: conditional update + append-only audit event in one transaction.
-- Callable only by service_role (server-side pipeline).

CREATE OR REPLACE FUNCTION public.apply_lead_lifecycle_transition(
  _lead_id uuid,
  _expected_from public.lead_lifecycle,
  _to public.lead_lifecycle,
  _event_type text,
  _summary text,
  _actor text,
  _metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated uuid;
BEGIN
  IF _expected_from = _to THEN
    RETURN jsonb_build_object('status', 'unchanged');
  END IF;

  UPDATE public.leads
  SET lifecycle = _to,
      updated_at = now()
  WHERE id = _lead_id
    AND lifecycle = _expected_from
  RETURNING id INTO _updated;

  IF _updated IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'stale',
      'reason', 'Lead lifecycle changed before transition could apply'
    );
  END IF;

  INSERT INTO public.lead_events (
    lead_id,
    event_type,
    summary,
    actor,
    metadata,
    from_lifecycle,
    to_lifecycle
  ) VALUES (
    _lead_id,
    _event_type,
    _summary,
    _actor,
    _metadata,
    _expected_from,
    _to
  );

  RETURN jsonb_build_object(
    'status', 'applied',
    'from', _expected_from::text,
    'to', _to::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_lead_lifecycle_transition(
  uuid,
  public.lead_lifecycle,
  public.lead_lifecycle,
  text,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_lead_lifecycle_transition(
  uuid,
  public.lead_lifecycle,
  public.lead_lifecycle,
  text,
  text,
  text,
  jsonb
) TO service_role;
