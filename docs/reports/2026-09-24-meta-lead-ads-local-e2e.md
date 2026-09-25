# Meta Lead Ads — local end-to-end run (2026-09-24)

Local, not live. The real route handlers (`/api/public/meta/webhook`, `/api/public/cron/reconcile-meta-leads`) and server modules ran against PostgreSQL 16 with the full migration chain, via PostgREST + supabase-js. Only graph.facebook.com, api.x.ai and RingCentral HTTP were stubbed. All ids, tokens and phone numbers are test fixtures. See `docs/META_LEAD_ADS_HANDOFF.md` for the live test procedure.

```text

### 1. Verification handshake
{
  "good": [
    200,
    "CH4LL3NGE"
  ],
  "wrongToken": 403
}

### 2. Signature rejection
{
  "unsigned": 401,
  "wrongSecret": 401,
  "tamperedBody": 401,
  "rowsAfter": "0"
}

### 3. Signed webhook → ingestion
{
  "status": 200,
  "body": {
    "received": 1,
    "ingested": 1,
    "duplicates": 0,
    "failed": 0
  }
}

###    meta_lead_submissions
900000000000001|WEBHOOK|ingested|facebook|2222222222|F1|Engine Quote|AD1|Engine swap promo|AS1|C1|Engine Replacement Q3|2026-09-24 14:44:48+00|form:F1:sha256:fd2b8bc98310d4ed

###    leads
Dana Webhook|+13125550101|dana@example.com|2014|Honda|Accord EX|142000|Knocking noise, check engine light|Facebook Lead Ads|unknown

###    raw_field_data preserved
6|what_year,_make_and_model_is_your_vehicle?

###    Grok job + run (after ingestion)
process_meta_lead|succeeded|meta:900000000000001|boltz-meta-first-touch-v1|send|900000000000001

###    lead_events
lead_created|
meta_lead_ingested|
first_touch_draft_ready|auto_first_touch_disabled

### 4. Replayed webhook x2
{
  "statuses": [
    200,
    200
  ],
  "bodies": [
    {
      "received": 1,
      "ingested": 0,
      "duplicates": 1,
      "failed": 0
    },
    {
      "received": 1,
      "ingested": 0,
      "duplicates": 1,
      "failed": 0
    }
  ],
  "submissions": "1",
  "leadsWithPhone": "1",
  "grokJobs": "1",
  "agentRuns": "1",
  "ingestedEvents": "1",
  "xaiCalls": 1
}

### 5. Webhook with Graph outage
{
  "status": 200,
  "body": {
    "received": 1,
    "ingested": 0,
    "duplicates": 0,
    "failed": 1
  },
  "row": "900000000000004|WEBHOOK|failed|1|Graph /900000000000004 failed (500): An unknown error occurr"
}

### 6. Reconciliation run 1
{
  "unauthorized": 401,
  "status": 200,
  "body": {
    "window": "incremental",
    "since": "2026-09-24T12:49:50.453Z",
    "forms": 1,
    "scanned": 5,
    "missingDetected": 3,
    "notIngested": 1,
    "ingested": 4,
    "duplicates": 0,
    "failed": 0,
    "retried": 0,
    "truncated": false,
    "errors": [],
    "processed": {
      "claimed": 4,
      "succeeded": 4,
      "failed": 0,
      "paused": false,
      "pauseDetail": null
    }
  }
}

###    submissions by method
900000000000001|WEBHOOK|ingested|facebook
900000000000002|RECONCILIATION|ingested|instagram
900000000000003|RECONCILIATION|ingested|facebook
900000000000004|WEBHOOK|ingested|facebook
900000000000005|RECONCILIATION|ingested|facebook

###    lead 5 attached to existing SMS lead
1|RingCentral SMS|Sam (SMS)

###    lead 2 consent (checkbox checked)
opted_in|true|web_form

### 7. Reconciliation runs 2 + nightly
{
  "run2": {
    "window": "incremental",
    "since": "2026-09-24T12:49:50.950Z",
    "forms": 1,
    "scanned": 5,
    "missingDetected": 0,
    "notIngested": 0,
    "ingested": 0,
    "duplicates": 0,
    "failed": 0,
    "retried": 0,
    "truncated": false,
    "errors": [],
    "processed": null
  },
  "nightly": {
    "window": "nightly",
    "since": "2026-09-17T14:49:50.972Z",
    "forms": 1,
    "scanned": 5,
    "missingDetected": 0,
    "notIngested": 0,
    "ingested": 0,
    "duplicates": 0,
    "failed": 0,
    "retried": 0,
    "truncated": false,
    "errors": [],
    "processed": null
  },
  "totals": "5|5",
  "leads": "5",
  "grokJobs": "5|5"
}

### 8. Manual import
{
  "existingLead": {
    "status": "duplicate",
    "leadId": "67006223-71f4-4380-b9c9-4b31dbeec867",
    "submissionId": "893670d9-1671-4e73-9068-f6f883993b4d"
  },
  "newLead": {
    "status": "ingested",
    "leadId": "206b5b7e-b32c-4105-85bd-ae6a4904791e",
    "created": true,
    "submissionId": "c05b4a4d-6691-4434-a085-39ecd9da10e5"
  },
  "row": "900000000000006|MANUAL_IMPORT|ingested"
}

### 9. Auto first touch (switch on)
{
  "rcSends": 1,
  "consented": "outbound|meta-first-touch:900000000000007|{+13125550107}",
  "noConsent": "first_touch_draft_ready|no_sms_consent"
}

### 10. Job queue
process_meta_lead|succeeded|8

### 11. /integration-health Meta section
{
  "configError": null,
  "secrets": [
    "META_APP_ID:configured",
    "META_APP_SECRET:configured",
    "META_PAGE_ID:configured",
    "META_PAGE_ACCESS_TOKEN:configured",
    "META_WEBHOOK_VERIFY_TOKEN:configured",
    "META_GRAPH_API_VERSION:missing",
    "META_AUTO_FIRST_TOUCH:configured"
  ],
  "webhook": {
    "configured": true,
    "callbackUrl": "https://boltz.test/api/public/meta/webhook",
    "lastWebhookAt": "2026-09-24T14:49:51.236488+00:00",
    "lastSignatureFailureAt": "2026-09-24T14:49:49.335179+00:00"
  },
  "subscription": {
    "status": "subscribed",
    "fields": [
      "leadgen"
    ],
    "detail": "App is subscribed to this Page's leadgen field"
  },
  "token": {
    "status": "valid",
    "type": "PAGE",
    "expiresAt": null,
    "missingScopes": [],
    "detail": "Token valid",
    "lastAuthFailureAt": null,
    "lastAuthFailureDetail": null
  },
  "graph": {
    "lastSuccessAt": "2026-09-24T14:49:51.329992+00:00",
    "lastFailureAt": "2026-09-24T14:49:50.386828+00:00",
    "lastFailureDetail": "Graph /900000000000004 failed (500): An unknown error occurred"
  },
  "reconciliation": {
    "lastIncremental": {
      "at": "2026-09-24T14:49:50.967829+00:00",
      "ok": true,
      "detail": "scanned 5, missing 0, ingested 0, duplicates 0"
    },
    "lastNightly": {
      "at": "2026-09-24T14:49:50.986073+00:00",
      "ok": true,
      "detail": "scanned 5, missing 0, ingested 0, duplicates 0"
    },
    "missingAtLastRun": 0
  },
  "lastLead": {
    "meta_lead_id": "900000000000008",
    "platform": "facebook",
    "ingestion_method": "WEBHOOK",
    "ingest_status": "ingested",
    "created_time": "2026-09-24T14:49:18+00:00",
    "ingested_at": "2026-09-24T14:49:51.359+00:00",
    "lead_id": "9a005565-4bf2-4cf0-b9e7-b1e3712a3f7b",
    "form_name": "Engine Quote"
  },
  "counts": {
    "total": 8,
    "notIngested": 0,
    "failed": 0,
    "byMethod": {
      "WEBHOOK": 4,
      "RECONCILIATION": 3,
      "MANUAL_IMPORT": 1
    }
  },
  "recent": 8
}

### Final submissions
900000000000001|WEBHOOK|ingested|facebook|t
900000000000002|RECONCILIATION|ingested|instagram|t
900000000000003|RECONCILIATION|ingested|facebook|t
900000000000004|WEBHOOK|ingested|facebook|t
900000000000005|RECONCILIATION|ingested|facebook|t
900000000000006|MANUAL_IMPORT|ingested|facebook|t
900000000000007|WEBHOOK|ingested|instagram|t
900000000000008|WEBHOOK|ingested|facebook|t

E2E HARNESS PASSED
```
