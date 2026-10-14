-- Backfill: a bot outbound SMS means the lead was contacted.
-- Only New leads move, and only to Contacted. Owner and staff texts stay as
-- they are. A failed outbound does not count. Re-running is a no-op because
-- the lead is no longer New.

DO $$
DECLARE
  rec record;
  msg_id uuid;
BEGIN
  FOR rec IN
    SELECT l.id
    FROM public.leads l
    WHERE l.lifecycle = 'New'::public.lead_lifecycle
      AND EXISTS (
        SELECT 1
        FROM public.lead_events e
        WHERE e.lead_id = l.id
          AND e.event_type = 'outbound_sent'
          AND e.actor LIKE 'bot:%'
      )
      AND EXISTS (
        SELECT 1
        FROM public.messages m
        WHERE m.lead_id = l.id
          AND m.direction = 'outbound'
          AND m.delivery_state IS DISTINCT FROM 'failed'
      )
  LOOP
    SELECT m.id
    INTO msg_id
    FROM public.messages m
    WHERE m.lead_id = rec.id
      AND m.direction = 'outbound'
      AND m.delivery_state IS DISTINCT FROM 'failed'
    ORDER BY m.created_at ASC
    LIMIT 1;

    IF msg_id IS NULL THEN
      CONTINUE;
    END IF;

    PERFORM public.apply_lead_lifecycle_transition(
      rec.id,
      'New'::public.lead_lifecycle,
      'Contacted'::public.lead_lifecycle,
      'lifecycle_changed',
      'Outbound SMS already sent; lifecycle moved from New to Contacted',
      'system',
      jsonb_build_object(
        'basis', 'outbound_sms',
        'evidence_ref', msg_id::text,
        'note', 'Backfill: bot outbound SMS while the lead was still New',
        'proposed_to', 'Contacted'
      )
    );
  END LOOP;
END $$;
