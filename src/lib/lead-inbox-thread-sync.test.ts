import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSendDestination,
  displayPhone,
  resolveThreadSync,
} from "./lead-inbox-thread-sync.ts";

const floyd = { id: "lead-floyd", name: "Floyd", phone_e164: "+13125550142" };
const floydThread = { id: "thread-floyd", lead_id: "lead-floyd", phone_e164: "+13125550142" };
const thetis = { id: "lead-thetis", name: "Thetis C.", phone_e164: "+13129221025" };
const adjuster = { id: "lead-adjuster", name: null, phone_e164: "+13128021681" };
const adjusterThread = { id: "thread-adjuster", lead_id: "lead-adjuster", phone_e164: "+13128021681" };

test("pending thread query blocks compose but keeps row identity", () => {
  const sync = resolveThreadSync({
    selectedLeadId: floyd.id,
    selectedRowPhone: floyd.phone_e164,
    selectedRowName: floyd.name,
    loadedLead: null,
    loadedThread: null,
    threadQueryPending: true,
  });
  assert.equal(sync.canCompose, false);
  assert.equal(sync.showLoading, true);
  assert.equal(sync.headerName, "Floyd");
  assert.equal(sync.destinationPhone, "3125550142");
});

test("Thetis row selected while adjuster thread loaded blocks compose and keeps Thetis header", () => {
  const sync = resolveThreadSync({
    selectedLeadId: thetis.id,
    selectedRowPhone: thetis.phone_e164,
    selectedRowName: thetis.name,
    loadedLead: adjuster,
    loadedThread: adjusterThread,
    threadQueryPending: false,
  });
  assert.equal(sync.inSync, false);
  assert.equal(sync.canCompose, false);
  assert.equal(sync.headerName, "Thetis C.");
  assert.equal(sync.destinationPhone, "3129221025");
  assert.ok(sync.blockReason);
});

test("row phone disagreeing with loaded lead phone blocks compose", () => {
  const sync = resolveThreadSync({
    selectedLeadId: floyd.id,
    selectedRowPhone: adjuster.phone_e164,
    selectedRowName: "Floyd",
    loadedLead: floyd,
    loadedThread: floydThread,
    threadQueryPending: false,
  });
  assert.equal(sync.canCompose, false);
});

test("matching row, lead and thread enables compose", () => {
  const sync = resolveThreadSync({
    selectedLeadId: floyd.id,
    selectedRowPhone: floyd.phone_e164,
    selectedRowName: floyd.name,
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
    loadedLead: adjuster,
    loadedThread: adjusterThread,
    headerPhone: adjuster.phone_e164,
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

test("displayPhone formats US numbers", () => {
  assert.equal(displayPhone("+13129221025"), "+1 (312) 922-1025");
  assert.equal(displayPhone(null), "Not entered");
});
