-- Data API grants for the lead-inbox foundation (RLS policies already exist).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_threads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalations TO authenticated;
GRANT SELECT, INSERT ON public.lead_events TO authenticated;
GRANT SELECT, UPDATE ON public.message_jobs TO authenticated;
GRANT SELECT ON public.agent_runs TO authenticated;
GRANT SELECT ON public.ringcentral_subscriptions TO authenticated;
GRANT SELECT ON public.integration_health_snapshots TO authenticated;

GRANT ALL ON public.leads TO service_role;
GRANT ALL ON public.lead_events TO service_role;
GRANT ALL ON public.message_threads TO service_role;
GRANT ALL ON public.messages TO service_role;
GRANT ALL ON public.message_jobs TO service_role;
GRANT ALL ON public.agent_runs TO service_role;
GRANT ALL ON public.escalations TO service_role;
GRANT ALL ON public.ringcentral_subscriptions TO service_role;
GRANT ALL ON public.integration_health_snapshots TO service_role;

REVOKE ALL ON public.leads FROM anon;
REVOKE ALL ON public.lead_events FROM anon;
REVOKE ALL ON public.message_threads FROM anon;
REVOKE ALL ON public.messages FROM anon;
REVOKE ALL ON public.message_jobs FROM anon;
REVOKE ALL ON public.agent_runs FROM anon;
REVOKE ALL ON public.escalations FROM anon;
REVOKE ALL ON public.ringcentral_subscriptions FROM anon;
REVOKE ALL ON public.integration_health_snapshots FROM anon;