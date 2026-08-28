-- Shop Manager appointments vertical slice foundation.
-- Appointments represent customer arrival/drop-off windows; overlapping windows are allowed.
-- Bay/technician capacity enforcement is deferred to a future owner decision.

DO $$ BEGIN
  CREATE TYPE public.appointment_status AS ENUM (
    'scheduled',
    'confirmed',
    'arrived',
    'in_service',
    'completed',
    'cancelled',
    'no_show'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  shop_timezone text NOT NULL DEFAULT 'America/Chicago',
  vehicle_year integer NULL,
  vehicle_make text NULL,
  vehicle_model text NULL,
  vehicle_description text NULL,
  service_summary text NOT NULL,
  source text NOT NULL DEFAULT 'shop_manager',
  external_reference text NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  cancellation_reason text NULL,
  no_show_reason text NULL,
  capacity_override_reason text NULL,
  CONSTRAINT appointments_valid_range CHECK (ends_at > starts_at),
  CONSTRAINT appointments_vehicle_year_range CHECK (
    vehicle_year IS NULL OR (vehicle_year >= 1900 AND vehicle_year <= 2100)
  )
);

CREATE INDEX IF NOT EXISTS appointments_starts_at_idx
  ON public.appointments (starts_at);

CREATE INDEX IF NOT EXISTS appointments_lead_id_starts_at_idx
  ON public.appointments (lead_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS appointments_status_starts_at_idx
  ON public.appointments (status, starts_at);

DROP TRIGGER IF EXISTS appointments_set_updated_at ON public.appointments;
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_staff_all ON public.appointments;
CREATE POLICY appointments_staff_all
  ON public.appointments
  FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.create_appointment_atomic(
  _lead_id uuid,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _shop_timezone text,
  _vehicle_year integer,
  _vehicle_make text,
  _vehicle_model text,
  _vehicle_description text,
  _service_summary text,
  _source text,
  _external_reference text,
  _created_by text,
  _capacity_override boolean,
  _override_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _appointment public.appointments;
BEGIN
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Appointment end must be after start';
  END IF;

  IF COALESCE(_capacity_override, false) AND (_override_reason IS NULL OR btrim(_override_reason) = '') THEN
    RAISE EXCEPTION 'Capacity override requires a reason';
  END IF;

  INSERT INTO public.appointments (
    lead_id,
    status,
    starts_at,
    ends_at,
    shop_timezone,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vehicle_description,
    service_summary,
    source,
    external_reference,
    created_by,
    updated_by,
    capacity_override_reason
  )
  VALUES (
    _lead_id,
    'scheduled',
    _starts_at,
    _ends_at,
    COALESCE(NULLIF(btrim(_shop_timezone), ''), 'America/Chicago'),
    _vehicle_year,
    NULLIF(btrim(_vehicle_make), ''),
    NULLIF(btrim(_vehicle_model), ''),
    NULLIF(btrim(_vehicle_description), ''),
    _service_summary,
    COALESCE(NULLIF(btrim(_source), ''), 'shop_manager'),
    NULLIF(btrim(_external_reference), ''),
    _created_by,
    _created_by,
    CASE WHEN COALESCE(_capacity_override, false) THEN LEFT(_override_reason, 600) ELSE NULL END
  )
  RETURNING * INTO _appointment;

  INSERT INTO public.lead_events (
    lead_id,
    event_type,
    summary,
    actor,
    metadata
  )
  VALUES (
    _lead_id,
    'appointment_created',
    LEFT('Appointment scheduled', 300),
    _created_by,
    jsonb_build_object(
      'appointment_id', _appointment.id,
      'starts_at', _appointment.starts_at,
      'ends_at', _appointment.ends_at,
      'shop_timezone', _appointment.shop_timezone,
      'capacity_override', COALESCE(_capacity_override, false),
      'override_reason', CASE WHEN COALESCE(_capacity_override, false) THEN LEFT(_override_reason, 600) ELSE NULL END
    )
  );

  IF COALESCE(_capacity_override, false) THEN
    INSERT INTO public.lead_events (
      lead_id,
      event_type,
      summary,
      actor,
      metadata
    )
    VALUES (
      _lead_id,
      'appointment_capacity_override',
      LEFT('Owner override recorded for future capacity rules', 300),
      _created_by,
      jsonb_build_object(
        'appointment_id', _appointment.id,
        'override_reason', LEFT(_override_reason, 600)
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'created',
    'appointment', to_jsonb(_appointment)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_appointment_atomic(
  _appointment_id uuid,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _updated_by text,
  _capacity_override boolean,
  _override_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing public.appointments;
  _appointment public.appointments;
BEGIN
  IF _ends_at <= _starts_at THEN
    RAISE EXCEPTION 'Appointment end must be after start';
  END IF;

  SELECT *
  INTO _existing
  FROM public.appointments
  WHERE id = _appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF _existing.status IN ('cancelled', 'no_show') THEN
    RETURN jsonb_build_object('status', 'invalid_status', 'current_status', _existing.status);
  END IF;

  IF COALESCE(_capacity_override, false) AND (_override_reason IS NULL OR btrim(_override_reason) = '') THEN
    RAISE EXCEPTION 'Capacity override requires a reason';
  END IF;

  UPDATE public.appointments
  SET
    starts_at = _starts_at,
    ends_at = _ends_at,
    updated_by = _updated_by,
    capacity_override_reason = CASE
      WHEN COALESCE(_capacity_override, false) THEN LEFT(_override_reason, 600)
      ELSE capacity_override_reason
    END
  WHERE id = _appointment_id
  RETURNING * INTO _appointment;

  INSERT INTO public.lead_events (
    lead_id,
    event_type,
    summary,
    actor,
    metadata
  )
  VALUES (
    _existing.lead_id,
    'appointment_rescheduled',
    LEFT('Appointment rescheduled', 300),
    _updated_by,
    jsonb_build_object(
      'appointment_id', _appointment_id,
      'from_starts_at', _existing.starts_at,
      'to_starts_at', _starts_at,
      'capacity_override', COALESCE(_capacity_override, false)
    )
  );

  IF COALESCE(_capacity_override, false) THEN
    INSERT INTO public.lead_events (
      lead_id,
      event_type,
      summary,
      actor,
      metadata
    )
    VALUES (
      _existing.lead_id,
      'appointment_capacity_override',
      LEFT('Owner override recorded while rescheduling', 300),
      _updated_by,
      jsonb_build_object(
        'appointment_id', _appointment_id,
        'override_reason', LEFT(_override_reason, 600)
      )
    );
  END IF;

  RETURN jsonb_build_object('status', 'rescheduled', 'appointment', to_jsonb(_appointment));
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_appointment_atomic(
  _appointment_id uuid,
  _reason text,
  _updated_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _appointment public.appointments;
BEGIN
  SELECT *
  INTO _appointment
  FROM public.appointments
  WHERE id = _appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  UPDATE public.appointments
  SET
    status = 'cancelled',
    cancellation_reason = LEFT(_reason, 600),
    updated_by = _updated_by
  WHERE id = _appointment_id
  RETURNING * INTO _appointment;

  INSERT INTO public.lead_events (
    lead_id,
    event_type,
    summary,
    actor,
    metadata
  )
  VALUES (
    _appointment.lead_id,
    'appointment_cancelled',
    LEFT('Appointment cancelled', 300),
    _updated_by,
    jsonb_build_object(
      'appointment_id', _appointment_id,
      'reason', LEFT(_reason, 600)
    )
  );

  RETURN jsonb_build_object('status', 'cancelled', 'appointment', to_jsonb(_appointment));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_appointment_arrived_atomic(
  _appointment_id uuid,
  _updated_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _appointment public.appointments;
BEGIN
  SELECT *
  INTO _appointment
  FROM public.appointments
  WHERE id = _appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  UPDATE public.appointments
  SET status = 'arrived', updated_by = _updated_by
  WHERE id = _appointment_id
  RETURNING * INTO _appointment;

  INSERT INTO public.lead_events (
    lead_id,
    event_type,
    summary,
    actor,
    metadata
  )
  VALUES (
    _appointment.lead_id,
    'appointment_arrived',
    LEFT('Customer marked arrived', 300),
    _updated_by,
    jsonb_build_object('appointment_id', _appointment_id)
  );

  RETURN jsonb_build_object('status', 'arrived', 'appointment', to_jsonb(_appointment));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_appointment_no_show_atomic(
  _appointment_id uuid,
  _reason text,
  _updated_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _appointment public.appointments;
BEGIN
  SELECT *
  INTO _appointment
  FROM public.appointments
  WHERE id = _appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  UPDATE public.appointments
  SET
    status = 'no_show',
    no_show_reason = LEFT(_reason, 600),
    updated_by = _updated_by
  WHERE id = _appointment_id
  RETURNING * INTO _appointment;

  INSERT INTO public.lead_events (
    lead_id,
    event_type,
    summary,
    actor,
    metadata
  )
  VALUES (
    _appointment.lead_id,
    'appointment_no_show',
    LEFT('Appointment marked no-show', 300),
    _updated_by,
    jsonb_build_object(
      'appointment_id', _appointment_id,
      'reason', LEFT(_reason, 600)
    )
  );

  RETURN jsonb_build_object('status', 'no_show', 'appointment', to_jsonb(_appointment));
END;
$$;

REVOKE ALL ON FUNCTION public.create_appointment_atomic(
  uuid,
  timestamptz,
  timestamptz,
  text,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_appointment_atomic(
  uuid,
  timestamptz,
  timestamptz,
  text,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.reschedule_appointment_atomic(
  uuid,
  timestamptz,
  timestamptz,
  text,
  boolean,
  text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reschedule_appointment_atomic(
  uuid,
  timestamptz,
  timestamptz,
  text,
  boolean,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_appointment_atomic(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_atomic(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.mark_appointment_arrived_atomic(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_appointment_arrived_atomic(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.mark_appointment_no_show_atomic(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_appointment_no_show_atomic(uuid, text, text) TO service_role;
