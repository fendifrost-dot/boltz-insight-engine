import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeadListRows,
  displayDeliveryState,
  mapProviderDeliveryState,
  matchExistingLeadForNewSms,
  mergeLeadListSources,
  recentOutboundBlocksFirstSms,
  sortLeadListRows,
} from "./lead-inbox-first-sms.ts";

/** 2026-08-28 1:58:35 PM CT = 18:58:35 UTC */
const AYALA_FIRST_OUTBOUND = "2026-08-28T18:58:35.000Z";
/** 2026-08-28 2:46:05 PM CT = 19:46:05 UTC */
const AYALA_SECOND_ATTEMPT = "2026-08-28T19:46:05.000Z";

const ayalaLead = {
  id: "lead-ayala",
  name: "Mr. Ayala",
  phone_e164: "+17085134404",
  last_message_at: null as string | null,
  last_inbound_at: null as string | null,
  last_outbound_at: null as string | null,
};

const ayalaOutbound = {
  lead_id: "lead-ayala",
  body: "Hi Mr. Ayala, this is Boltz Auto calling you back about the 1998 Mercury Grand Marquis.",
  direction: "outbound" as const,
  delivery_state: "queued",
  created_at: AYALA_FIRST_OUTBOUND,
};

test("Ayala repro: list preview shows owner_outbound without opening the thread even if last_message_at is stale", () => {
  const [row] = buildLeadListRows([ayalaLead], [ayalaOutbound]);
  assert.ok(row);
  assert.equal(row.last_preview_direction, "outbound");
  assert.equal(row.last_preview_at, AYALA_FIRST_OUTBOUND);
  assert.match(row.last_preview_body ?? "", /Boltz Auto/);
  assert.equal(row.last_message_at, null);
});

test("Ayala repro: New/leads list sorts a stale-timestamp outbound above older stamped leads", () => {
  const older = {
    id: "lead-older",
    last_message_at: "2026-08-27T12:00:00.000Z",
    last_inbound_at: "2026-08-27T12:00:00.000Z",
    last_outbound_at: null as string | null,
  };
  const rows = sortLeadListRows(buildLeadListRows([older, ayalaLead], [ayalaOutbound]));
  assert.equal(rows[0]?.id, "lead-ayala");
});

test("Ayala repro: first-SMS path refuses a second send when an outbound exists in the last 24 hours", () => {
  const guard = recentOutboundBlocksFirstSms({
    nowMs: Date.parse(AYALA_SECOND_ATTEMPT),
    lastOutboundAt: null,
    latestOutboundMessageAt: AYALA_FIRST_OUTBOUND,
  });
  assert.equal(guard.block, true);
  if (guard.block) {
    assert.equal(guard.sentAt, AYALA_FIRST_OUTBOUND);
    assert.match(guard.reason, /already sent an outbound sms/i);
  }
});

test("Ayala repro: New SMS compose matches the existing number from the list without opening the thread", () => {
  const [row] = buildLeadListRows([ayalaLead], [ayalaOutbound]);
  assert.ok(row);
  const match = matchExistingLeadForNewSms(
    "(708) 513-4404",
    [row],
    Date.parse(AYALA_SECOND_ATTEMPT),
  );
  assert.ok(match);
  assert.equal(match.lead.id, "lead-ayala");
  assert.equal(match.blocksFirstSms, true);
});

test("first-SMS path allows a number with no prior outbound", () => {
  const guard = recentOutboundBlocksFirstSms({
    nowMs: Date.parse(AYALA_SECOND_ATTEMPT),
    lastOutboundAt: null,
    latestOutboundMessageAt: null,
  });
  assert.equal(guard.block, false);
});

test("first-SMS path allows an outbound older than 24 hours", () => {
  const guard = recentOutboundBlocksFirstSms({
    nowMs: Date.parse("2026-08-29T19:00:00.000Z"),
    latestOutboundMessageAt: AYALA_FIRST_OUTBOUND,
  });
  assert.equal(guard.block, false);
});

test("stale last_outbound_at still blocks when outbound_sent event exists", () => {
  const guard = recentOutboundBlocksFirstSms({
    nowMs: Date.parse(AYALA_SECOND_ATTEMPT),
    lastOutboundAt: null,
    latestOutboundSentEventAt: AYALA_FIRST_OUTBOUND,
  });
  assert.equal(guard.block, true);
});

test("inbound-only last activity does not look like an unanswered outbound", () => {
  const [row] = buildLeadListRows(
    [
      {
        id: "lead-in",
        last_message_at: "2026-08-28T18:00:00.000Z",
        last_inbound_at: "2026-08-28T18:00:00.000Z",
        last_outbound_at: null,
      },
    ],
    [],
  );
  assert.ok(row);
  assert.equal(row.last_preview_direction, "inbound");
});

test("merge keeps a newly created owner_outbound lead that last_message_at sort would drop", () => {
  const hidden = { id: "lead-ayala", name: "Mr. Ayala" };
  const visible = { id: "lead-other", name: "Other" };
  const merged = mergeLeadListSources([visible], [hidden]);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((row) => row.id === "lead-ayala"));
});

test("RingCentral Queued after a successful POST maps to sent, not queued", () => {
  assert.equal(mapProviderDeliveryState("Queued"), "sent");
  assert.equal(mapProviderDeliveryState("Sent"), "sent");
  assert.equal(mapProviderDeliveryState("Delivered"), "delivered");
  assert.equal(mapProviderDeliveryState("DeliveryFailed"), "failed");
});

test("A2P empty status after HTTP success maps to sent", () => {
  assert.equal(mapProviderDeliveryState(undefined), "sent");
});

test("thread bubble shows sent when audit recorded a provider-accepted outbound still stored as queued", () => {
  assert.equal(
    displayDeliveryState({
      direction: "outbound",
      delivery_state: "queued",
      provider_message_id: "rc-ayala-1",
    }),
    "sent",
  );
});

test("bubble stays queued only when the provider never accepted the send", () => {
  assert.equal(
    displayDeliveryState({
      direction: "outbound",
      delivery_state: "queued",
      provider_message_id: null,
    }),
    "queued",
  );
});
