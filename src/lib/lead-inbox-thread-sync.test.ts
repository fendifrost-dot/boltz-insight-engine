import test from "node:test";
import assert from "node:assert/strict";
import { assertSendDestination, resolveThreadSync } from "./lead-inbox-thread-sync.ts";

const floyd = { id: "lead-floyd", name: "Floyd", phone_e164: "+13125550142" };
const floydThread = { id: "thread-floyd", lead_id: "lead-floyd", phone_e164: "+13125550142" };
const thetis = { id: "lead-thetis", name: "Thetis C.", phone_e164: "+13129221025" };
const thetisThread = { id: "thread-thetis", lead_id: "lead-thetis", phone_e164: "+13129221025" };

test("pending thread query blocks compose", () => {
  const sync = resolveThreadSync({
    selectedLeadId: floyd.id,
    loadedLead: null,
    loadedThread: null,
    threadQueryPending: true,
  });
  assert.equal(sync.canCompose, false);
  assert.equal(sync.showLoading, true);
});

test("Floyd highlighted while Thetis is loaded blocks compose", () => {
  const sync = resolveThreadSync({
    selectedLeadId: floyd.id,
    loadedLead: thetis,
    loadedThread: thetisThread,
    threadQueryPending: false,
  });
  assert.equal(sync.inSync, false);
  assert.equal(sync.canCompose, false);
  assert.equal(sync.destinationPhone, null);
  assert.ok(sync.blockReason);
});

test("matching Floyd lead and thread enables compose", () => {
  const sync = resolveThreadSync({
    selectedLeadId: floyd.id,
    loadedLead: floyd,
    loadedThread: floydThread,
    threadQueryPending: false,
  });
  assert.equal(sync.canCompose, true);
  assert.equal(sync.destinationPhone, "3125550142");
  assert.equal(sync.headerName, "Floyd");
  assert.equal(sync.blockReason, null);
});

test("assertSendDestination refuses row A sending to conversation B", () => {
  const result = assertSendDestination({
    selectedLeadId: floyd.id,
    loadedLead: thetis,
    loadedThread: thetisThread,
    headerPhone: thetis.phone_e164,
  });
  assert.equal(result.ok, false);
});

test("assertSendDestination allows a fully matching send", () => {
  const result = assertSendDestination({
    selectedLeadId: floyd.id,
    loadedLead: floyd,
    loadedThread: floydThread,
    headerPhone: floyd.phone_e164,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.leadId, "lead-floyd");
    assert.equal(result.threadId, "thread-floyd");
    assert.equal(result.phone, "3125550142");
  }
});

test("assertSendDestination blocks a header phone mismatch", () => {
  const result = assertSendDestination({
    selectedLeadId: floyd.id,
    loadedLead: floyd,
    loadedThread: floydThread,
    headerPhone: thetis.phone_e164,
  });
  assert.equal(result.ok, false);
});
