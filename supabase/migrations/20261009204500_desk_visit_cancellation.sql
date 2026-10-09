BEGIN;

CREATE OR REPLACE FUNCTION public.set_desk_appointment(
  _lead_id uuid, _appointment_at timestamptz, _expected_appointment_at timestamptz, _actor text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_row public.leads%ROWTYPE;
BEGIN
  SELECT * INTO current_row FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'Customer not found.'); END IF;
  IF current_row.appointment_at IS NOT DISTINCT FROM _appointment_at THEN RETURN jsonb_build_object('ok', true); END IF;
  IF current_row.appointment_at IS DISTINCT FROM _expected_appointment_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'The visit was changed by someone else. Refresh and try again.');
  END IF;
  UPDATE public.leads SET appointment_at = _appointment_at,
    appointment_interest = CASE WHEN _appointment_at IS NOT NULL THEN true ELSE appointment_interest END
    WHERE id = _lead_id;
  INSERT INTO public.lead_events(lead_id, event_type, actor, summary, metadata)
  VALUES (_lead_id, 'desk_appointment', _actor,
    CASE WHEN _appointment_at IS NULL THEN 'Shop visit cancelled' ELSE 'Shop visit booked' END,
    jsonb_build_object('appointment_at', _appointment_at, 'previous_appointment_at', current_row.appointment_at, 'time_zone', 'America/Chicago'));
  -- Cancelling a booked visit moves back exactly one existing lifecycle stage.
  IF _appointment_at IS NULL AND current_row.lifecycle = 'Appointment Scheduled' THEN
    PERFORM public.apply_lead_lifecycle_transition(
      _lead_id, 'Appointment Scheduled', 'Qualified', 'lifecycle_changed',
      'Visit cancelled; ready to arrange another time', _actor,
      jsonb_build_object('basis', 'staff_observation', 'evidence_ref', 'desk-appointment-cancelled')
    );
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.set_desk_appointment(uuid,timestamptz,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_desk_appointment(uuid,timestamptz,timestamptz,text) TO service_role;

COMMIT;
