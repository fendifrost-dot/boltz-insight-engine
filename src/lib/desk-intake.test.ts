import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_LEAD_SOURCES } from "../server/intake/parse-email.ts";
import { toValidE164 } from "../server/intake/parse-email.ts";
import { LEAD_SOURCE_PATTERN } from "../server/lead-inbox/bot-api.policy.ts";
import { META_LEAD_SOURCE } from "../server/meta-leads/normalize.ts";
import {
  CANONICAL_LEAD_SOURCES,
  DESK_LEAD_SOURCE_PATTERN,
  appendDeskNote,
  attachAdsCallDecision,
  attributionUpdate,
  decideDeskIntake,
  deskEventMetadata,
  deskLifecycleChoices,
  deskNoteEvent,
  deskSearchOr,
  deskSearchPlan,
  mapHeardAboutToLeadSource,
  normalizeDeskIntake,
  phoneIntakeDisposition,
  pickGoogleAdsCall,
  toDeskE164,
  type AdsCallHit,
  type NormalizedDeskIntake,
} from "./desk-intake.ts";

const NOW = new Date("2026-10-09T18:00:00Z");
const STAFF = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const KEY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function intake(patch: Partial<NormalizedDeskIntake> = {}): NormalizedDeskIntake {
  const base: NormalizedDeskIntake = {
    channel: "phone",
    name: "Sam",
    phone: "+13125550100",
    vehicleYear: 2018,
    vehicleMake: "Toyota",
    vehicleModel: "Camry",
    concern: "Brake noise",
    heardAbout: "yelp",
    heardAboutOther: null,
    appointmentInterest: false,
    notes: null,
    idempotencyKey: KEY,
    staffUserId: STAFF,
    now: NOW,
  };
  return Object.assign(base, patch);
}

const hit: AdsCallHit = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  startedAt: "2026-10-08T15:00:00Z",
  weekStart: "2026-10-05",
  adsCallWeeklyId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
};

test("desk phone normalization matches email intake", () => {
  assert.equal(DESK_LEAD_SOURCE_PATTERN.source, LEAD_SOURCE_PATTERN.source);
  for (const raw of [
    "(312) 555-0100",
    "3125550100",
    "+1 312 555 0100",
    "13125550100",
    "nope",
    "",
  ]) {
    assert.equal(toDeskE164(raw), toValidE164(raw));
  }
});

function leadSource(
  heardAbout: Parameters<typeof mapHeardAboutToLeadSource>[0]["heardAbout"],
  googleAdsCallMatched = false,
  otherText: string | null = null,
): string {
  const mapped = mapHeardAboutToLeadSource({ heardAbout, otherText, googleAdsCallMatched });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return "";
  return mapped.leadSource;
}

test("the pick-list maps onto existing lead_source values", () => {
  assert.equal(leadSource("yelp"), "Yelp");
  assert.ok(EMAIL_LEAD_SOURCES.includes("Yelp"));
  assert.equal(leadSource("facebook"), META_LEAD_SOURCE.facebook);
  assert.equal(leadSource("instagram"), META_LEAD_SOURCE.instagram);
  assert.equal(leadSource("google", false), "Google Business Profile");
  assert.ok(EMAIL_LEAD_SOURCES.includes("Google Business Profile"));
  assert.equal(leadSource("google", true), "Google Ads");
  assert.ok(EMAIL_LEAD_SOURCES.includes("Google Ads"));
  assert.equal(leadSource("referral"), "Referral");
  assert.equal(leadSource("returning"), "Returning customer");
  assert.equal(leadSource("drive_by"), "Drive-by");
  assert.ok(CANONICAL_LEAD_SOURCES.includes("Referral"));
});

test("other snaps to a known source and rejects unsafe text", () => {
  const snapped = mapHeardAboutToLeadSource({
    heardAbout: "other",
    otherText: "google ads",
    googleAdsCallMatched: false,
  });
  assert.equal(snapped.ok && snapped.leadSource, "Google Ads");
  const custom = mapHeardAboutToLeadSource({
    heardAbout: "other",
    otherText: "Nextdoor",
    googleAdsCallMatched: false,
  });
  assert.equal(custom.ok && custom.leadSource, "Nextdoor");
  assert.equal(
    mapHeardAboutToLeadSource({ heardAbout: "other", otherText: "  ", googleAdsCallMatched: false })
      .ok,
    false,
  );
  assert.equal(
    mapHeardAboutToLeadSource({
      heardAbout: "other",
      otherText: "yelp;drop",
      googleAdsCallMatched: false,
    }).ok,
    false,
  );
});

test("a phone logged inside 12 hours is a duplicate and an older phone is the same lead", () => {
  assert.equal(
    phoneIntakeDisposition({ existingCreatedAt: "2026-10-09T12:00:00Z", now: NOW }),
    "duplicate",
  );
  assert.equal(
    phoneIntakeDisposition({ existingCreatedAt: "2026-10-08T17:00:00Z", now: NOW }),
    "existing",
  );
  assert.equal(phoneIntakeDisposition({ existingCreatedAt: null, now: NOW }), "new");
});

test("create stores a desk lead and does not duplicate a known phone", () => {
  const created = decideDeskIntake({
    intake: intake(),
    actor: `staff:${STAFF}`,
    existing: null,
    idempotentLeadId: null,
    adsHits: [],
  });
  assert.equal(created.ok, true);
  if (!created.ok || created.plan.action !== "create") return;
  assert.equal(created.plan.row.lifecycle, "New");
  assert.equal(created.plan.row.intake_path, "desk");
  assert.equal(created.plan.row.intake_channel, "phone");
  assert.equal(created.plan.row.created_by, STAFF);
  assert.equal(created.plan.row.lead_source, "Yelp");
  assert.equal(created.plan.row.symptoms, "Brake noise");
  assert.equal(created.plan.row.google_ads_call_id, null);
  assert.deepEqual(Object.keys(created.plan.event.metadata).sort(), [
    "channel",
    "google_ads_call_linked",
    "heard_about",
    "intake_path",
    "lead_source",
    "week_start",
  ]);

  const recent = decideDeskIntake({
    intake: intake(),
    actor: `staff:${STAFF}`,
    existing: { id: "lead-1", createdAt: "2026-10-09T17:00:00Z" },
    idempotentLeadId: null,
    adsHits: [],
  });
  assert.equal(recent.ok && recent.plan.action, "duplicate");

  const older = decideDeskIntake({
    intake: intake(),
    actor: `staff:${STAFF}`,
    existing: { id: "lead-1", createdAt: "2026-09-01T17:00:00Z" },
    idempotentLeadId: null,
    adsHits: [],
  });
  assert.equal(older.ok && older.plan.action, "existing");
});

test("a phone lead links the newest recent Google Ads call and a walk-in does not", () => {
  const olderHit: AdsCallHit = {
    ...hit,
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    startedAt: "2026-10-01T15:00:00Z",
  };
  const linked = pickGoogleAdsCall({ channel: "phone", hits: [olderHit, hit], now: NOW });
  assert.equal(linked?.id, hit.id);
  assert.equal(pickGoogleAdsCall({ channel: "walk_in", hits: [hit], now: NOW }), null);
  assert.equal(
    pickGoogleAdsCall({
      channel: "phone",
      hits: [{ ...hit, startedAt: "2026-09-01T15:00:00Z" }],
      now: NOW,
    }),
    null,
  );

  const google = intake();
  google.heardAbout = "google";
  const plan = decideDeskIntake({
    intake: google,
    actor: `staff:${STAFF}`,
    existing: null,
    idempotentLeadId: null,
    adsHits: [hit],
  });
  assert.equal(plan.ok, true);
  if (!plan.ok || plan.plan.action !== "create") return;
  assert.equal(plan.plan.row.lead_source, "Google Ads");
  assert.equal(plan.plan.row.google_ads_call_id, hit.id);

  const yelp = decideDeskIntake({
    intake: intake(),
    actor: `staff:${STAFF}`,
    existing: null,
    idempotentLeadId: null,
    adsHits: [hit],
  });
  if (!yelp.ok || yelp.plan.action !== "create") return;
  assert.equal(yelp.plan.row.lead_source, "Yelp");
  assert.equal(yelp.plan.row.google_ads_call_id, hit.id);

  const walkIn = intake();
  walkIn.channel = "walk_in";
  walkIn.heardAbout = "google";
  const walked = decideDeskIntake({
    intake: walkIn,
    actor: `staff:${STAFF}`,
    existing: null,
    idempotentLeadId: null,
    adsHits: [hit],
  });
  if (!walked.ok || walked.plan.action !== "create") return;
  assert.equal(walked.plan.row.lead_source, "Google Business Profile");
  assert.equal(walked.plan.row.google_ads_call_id, null);
});

test("desk events keep customer text out of metadata", () => {
  const meta = deskEventMetadata({
    channel: "phone",
    heardAbout: "other",
    leadSource: "Nextdoor",
    googleAdsCall: hit,
  });
  assert.equal("lead_source" in meta, false);
  assert.equal(meta.google_ads_call_linked, true);
  assert.equal(JSON.stringify(meta).includes("Nextdoor"), false);
  const note = deskNoteEvent(12, `staff:${STAFF}`);
  assert.deepEqual(note.metadata, { notes_length: 12 });
  assert.equal(note.summary.includes("12"), false);
});

test("notes append and attribution do not invent a second source column", () => {
  const appended = appendDeskNote("old", "called back", NOW);
  assert.equal(appended.ok, true);
  if (!appended.ok) return;
  assert.match(appended.notes, /called back/);
  const missing = attributionUpdate({
    currentSource: null,
    heardAbout: "yelp",
    otherText: null,
    googleAdsCallMatched: false,
    confirm: false,
  });
  assert.equal(missing.ok && missing.leadSource, "Yelp");
  const blocked = attributionUpdate({
    currentSource: "Yelp",
    heardAbout: "google",
    otherText: null,
    googleAdsCallMatched: true,
    confirm: false,
  });
  assert.equal(blocked.ok, false);
  const corrected = attributionUpdate({
    currentSource: "Google Business Profile",
    heardAbout: "google",
    otherText: null,
    googleAdsCallMatched: true,
    confirm: true,
  });
  assert.equal(corrected.ok && corrected.leadSource, "Google Ads");
  const keepYelp = attachAdsCallDecision({ currentSource: "Yelp", match: hit });
  assert.equal(keepYelp.ok && keepYelp.leadSource, null);
  const upgrade = attachAdsCallDecision({ currentSource: "Google Business Profile", match: hit });
  assert.equal(upgrade.ok && upgrade.leadSource, "Google Ads");
});

test("search uses the phone or a safe text filter", () => {
  assert.equal(deskSearchPlan("").phoneExact, null);
  assert.equal(deskSearchPlan("(312) 555-0100").phoneExact, "+13125550100");
  const text = deskSearchPlan('Camry "drop"');
  assert.equal(text.text?.includes('"'), false);
  assert.equal(text.text?.includes("%"), false);
  const filter = deskSearchOr(text);
  assert.match(filter ?? "", /vehicle_model\.ilike/);
  assert.match(filter ?? "", /lead_source\.ilike/);
  assert.equal(deskSearchOr({ phoneExact: "+13125550100", text: null, phoneDigits: null }), null);
});

test("staff status choices include contacted and no-show and never Paid", () => {
  const fromNew = deskLifecycleChoices("New");
  assert.ok(fromNew.includes("Contacted"));
  assert.ok(fromNew.includes("No-show"));
  assert.equal(fromNew.includes("Paid"), false);
  assert.equal(fromNew.includes("Appointment Scheduled"), false);
  assert.ok(deskLifecycleChoices("Qualified").includes("Appointment Scheduled"));
  assert.equal(deskLifecycleChoices("Completed").includes("Paid"), false);
});

test("normalize rejects a bad phone and allows a blank one", () => {
  const bad = normalizeDeskIntake(
    {
      channel: "walk_in",
      heardAbout: "drive_by",
      phone: "555",
      appointmentInterest: false,
      idempotencyKey: KEY,
    },
    NOW,
    STAFF,
  );
  assert.equal(bad.ok, false);
  const ok = normalizeDeskIntake(
    {
      channel: "walk_in",
      heardAbout: "drive_by",
      appointmentInterest: true,
      idempotencyKey: KEY,
      name: "  ",
    },
    NOW,
    STAFF,
  );
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.normalized.phone, null);
  assert.equal(ok.normalized.name, null);
  assert.equal(ok.normalized.appointmentInterest, true);
});
