-- RingCentral voicemail metadata, voicemail transcription text, and AI call notes.
-- Read-only against RingCentral. This migration does not send SMS, place calls, or change lead lifecycle.
-- Apply it in the usual migration path. Do not run it by hand against production from an agent.
-- Browser roles cannot read these tables. service_role (server routes) is the only reader and writer.
-- Attachment URIs, recording content URIs, and audio files are not stored.

CREATE TABLE IF NOT EXISTS public.ringcentral_sync_cursors (
  stream text PRIMARY KEY CHECK (stream IN ('voicemail', 'call_insights')),
  watermark timestamptz,
  last_status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ringcentral_sync_cursors IS
  'Incremental watermarks for RingCentral voicemail and call-note sync. No message bodies or phone numbers.';

CREATE TABLE IF NOT EXISTS public.ringcentral_voicemails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL UNIQUE CHECK (provider_message_id ~ '^[0-9]{1,40}$'),
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  phone_e164 text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  direction text CHECK (direction IS NULL OR direction IN ('inbound', 'outbound')),
  creation_time timestamptz,
  last_modified_time timestamptz,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  read_status text CHECK (read_status IS NULL OR char_length(read_status) <= 40),
  availability text CHECK (availability IS NULL OR char_length(availability) <= 40),
  transcription_status text CHECK (
    transcription_status IS NULL OR char_length(transcription_status) <= 40
  ),
  transcription_text text CHECK (
    transcription_text IS NULL OR char_length(transcription_text) <= 20000
  ),
  caller_name text CHECK (caller_name IS NULL OR char_length(caller_name) <= 80),
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ringcentral_voicemails IS
  'RingCentral message-store voicemails for the shop extension. Idempotent on provider_message_id. Transcription text only; no audio and no attachment URI.';
COMMENT ON COLUMN public.ringcentral_voicemails.provider_message_id IS
  'RingCentral message-store id. Replays update this row and do not create a second lead.';
COMMENT ON COLUMN public.ringcentral_voicemails.needs_review IS
  'True when the caller phone could not be matched or stored as E.164. No lead is created in that case.';

CREATE INDEX IF NOT EXISTS ringcentral_voicemails_creation_idx
  ON public.ringcentral_voicemails (creation_time DESC);
CREATE INDEX IF NOT EXISTS ringcentral_voicemails_lead_idx
  ON public.ringcentral_voicemails (lead_id, creation_time DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ringcentral_voicemails_phone_idx
  ON public.ringcentral_voicemails (phone_e164, creation_time DESC)
  WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ringcentral_call_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id text UNIQUE CHECK (call_id IS NULL OR call_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  telephony_session_id text UNIQUE CHECK (
    telephony_session_id IS NULL OR telephony_session_id ~ '^[A-Za-z0-9_.:-]{1,80}$'
  ),
  recording_id text CHECK (recording_id IS NULL OR recording_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  phone_e164 text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  direction text CHECK (direction IS NULL OR direction IN ('inbound', 'outbound')),
  started_at timestamptz,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  result_detail text CHECK (result_detail IS NULL OR char_length(result_detail) <= 80),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 8000),
  transcript text CHECK (transcript IS NULL OR char_length(transcript) <= 20000),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ringcentral_call_insights_identity CHECK (
    call_id IS NOT NULL OR telephony_session_id IS NOT NULL
  )
);

COMMENT ON TABLE public.ringcentral_call_insights IS
  'RingCentral AI notes and transcripts for connected calls. Idempotent on call_id and telephony_session_id. No recording audio and no content URI.';
COMMENT ON COLUMN public.ringcentral_call_insights.recording_id IS
  'RingCentral recording id used to request insights. The recording file is not downloaded.';

CREATE INDEX IF NOT EXISTS ringcentral_call_insights_started_idx
  ON public.ringcentral_call_insights (started_at DESC);
CREATE INDEX IF NOT EXISTS ringcentral_call_insights_lead_idx
  ON public.ringcentral_call_insights (lead_id, started_at DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ringcentral_call_insights_phone_idx
  ON public.ringcentral_call_insights (phone_e164, started_at DESC)
  WHERE phone_e164 IS NOT NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ringcentral_sync_cursors',
    'ringcentral_voicemails',
    'ringcentral_call_insights'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
