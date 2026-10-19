/**
 * Google Ads REST major version. One line to bump.
 *
 * The REST path is the major version only. Minor releases update that same
 * host path in place; they do not get their own URL.
 *
 * Chosen 2026-10-19 from https://developers.google.com/google-ads/api/docs/sunset-dates
 * v26 (released 2026-10-14) is the newest stable major version. Sunset: November 2027.
 * The previous pin was sunset on 2026-10-07 and returns HTTP 400 UNSUPPORTED_VERSION.
 *
 * v23–v26 breaking changes do not touch the GAQL this repo sends. Rechecked
 * against the v26 field reference and protos: customer, campaign (including
 * metrics.phone_calls, metrics.average_cpc, segments.conversion_action_name,
 * segments.conversion_action_category = PHONE_CALL_LEAD), keyword_view,
 * search_term_view (including segments.keyword.info), call_view, and
 * lead_form_submission_data. Campaign.start_date / end_date were removed in
 * v23; nothing here selects them.
 */
export const GOOGLE_ADS_API_VERSION = "v26" as const;

export const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
