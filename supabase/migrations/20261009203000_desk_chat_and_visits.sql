BEGIN;

-- The existing customer is still the authority. No duplicate CRM or appointment table.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS appointment_at timestamptz;
CREATE INDEX IF NOT EXISTS leads_appointment_at_idx ON public.leads (appointment_at) WHERE appointment_at IS NOT NULL;
COMMENT ON COLUMN public.leads.appointment_at IS 'Next confirmed shop visit. Stored as an instant, entered/displayed in America/Chicago. Interest alone is not a booking.';

CREATE OR REPLACE FUNCTION public.protect_desk_appointment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') OR
     COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.appointment_at IS NOT NULL) OR
     (TG_OP = 'UPDATE' AND NEW.appointment_at IS DISTINCT FROM OLD.appointment_at) THEN
    RAISE EXCEPTION 'Use the shop desk to save a visit' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_desk_appointment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS leads_protect_desk_appointment ON public.leads;
CREATE TRIGGER leads_protect_desk_appointment BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.protect_desk_appointment();

-- One shared, internal conversation. Never enters the customer SMS job queue.
CREATE TABLE IF NOT EXISTS public.desk_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL CHECK (role IN ('staff', 'assistant', 'agent', 'system')),
  sender text NOT NULL CHECK (char_length(sender) BETWEEN 1 AND 100),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  staff_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.mcp_agents(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  reply_to uuid REFERENCES public.desk_chat_messages(id),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.desk_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_chat_messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.desk_chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.desk_chat_messages TO authenticated;
GRANT ALL ON public.desk_chat_messages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.desk_chat_messages_sequence_seq TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'desk_chat_messages' AND policyname = 'desk_chat_staff_read') THEN
    CREATE POLICY desk_chat_staff_read ON public.desk_chat_messages FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'desk_chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.desk_chat_messages;
  END IF;
END $$;

-- Save the date and its audit entry together. Does not skip lifecycle stages.
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
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.set_desk_appointment(uuid,timestamptz,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_desk_appointment(uuid,timestamptz,timestamptz,text) TO service_role;

COMMIT;
