-- Weekly Google Ads call aggregates for the Monday report.
-- One row per week_start and customer_id. Counts and durations only.
-- No schedule: the weekly report bot calls the route.

CREATE TABLE IF NOT EXISTS public.ads_call_weekly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  week_start date NOT NULL,
  week_end date NOT NULL,
  customer_id text NOT NULL,
  call_reporting_ok boolean NOT NULL,
  detail text NULL,
  total_calls integer NULL,
  answered_calls integer NULL,
  missed_calls integer NULL,
  other_calls integer NULL,
  answered_duration_seconds integer NULL,
  answered_avg_duration_seconds numeric NULL,
  calls_by_campaign jsonb NULL,
  calls_by_day jsonb NULL,
  lead_form_submissions integer NULL,
  phone_calls integer NULL,
  call_conversions numeric NULL,
  metrics_by_campaign jsonb NULL,
  CONSTRAINT ads_call_weekly_week_customer_unique UNIQUE (week_start, customer_id),
  CONSTRAINT ads_call_weekly_week_order CHECK (week_end >= week_start),
  CONSTRAINT ads_call_weekly_calls_consistent CHECK (
    (
      call_reporting_ok
      AND total_calls IS NOT NULL
      AND answered_calls IS NOT NULL
      AND missed_calls IS NOT NULL
      AND other_calls IS NOT NULL
      AND answered_duration_seconds IS NOT NULL
      AND calls_by_campaign IS NOT NULL
      AND calls_by_day IS NOT NULL
      AND total_calls >= 0
      AND answered_calls >= 0
      AND missed_calls >= 0
      AND other_calls >= 0
      AND answered_duration_seconds >= 0
      AND answered_calls + missed_calls + other_calls = total_calls
      AND (
        (answered_calls = 0 AND answered_avg_duration_seconds IS NULL)
        OR (answered_calls > 0 AND answered_avg_duration_seconds IS NOT NULL)
      )
    )
    OR (
      NOT call_reporting_ok
      AND total_calls IS NULL
      AND answered_calls IS NULL
      AND missed_calls IS NULL
      AND other_calls IS NULL
      AND answered_duration_seconds IS NULL
      AND answered_avg_duration_seconds IS NULL
      AND calls_by_campaign IS NULL
      AND calls_by_day IS NULL
    )
  )
);

ALTER TABLE public.ads_call_weekly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ads_call_weekly_staff_select" ON public.ads_call_weekly;
CREATE POLICY "ads_call_weekly_staff_select" ON public.ads_call_weekly
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

GRANT SELECT ON public.ads_call_weekly TO authenticated;
GRANT ALL ON public.ads_call_weekly TO service_role;
REVOKE ALL ON public.ads_call_weekly FROM anon;

DROP TRIGGER IF EXISTS ads_call_weekly_set_updated_at ON public.ads_call_weekly;
CREATE TRIGGER ads_call_weekly_set_updated_at
  BEFORE UPDATE ON public.ads_call_weekly
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
