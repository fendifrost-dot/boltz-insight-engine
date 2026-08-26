import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSendDestination,
  displayPhone,
  resolveThreadSync,
} from "./lead-inbox-thread-sync.ts";

const floyd = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Floyd",
  phone_e164: "+13125550111",
};
const thetis = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Thetis C.",
  phone_e164: "+13129221025",
};
const adjuster = {
  id: "33333333-3333-3333-3333-333333333333",
  name: null as string | null,
  phone_e164: "+13128021681",
};
const floydThread = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  lead_id: floyd.id,
  phone_e164: floyd.phone_e164,
};
const thetisThread = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  lead_id: thetis.id,
  phone_e164: thetis.phone_e164,
};
const adjusterThread = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  lead_id: adjuster.id,
  phone_e164: adjuster.phone_e164,
};

describe("resolveThreadSync", () => {
  it("shows clicked-row name/phone in the header while loading", () => {
    const state = resolveThreadSync({
      selectedLeadId: thetis.id,
      selectedRowPhone: thetis.phone_e164,
      selectedRowName: thetis.name,
      loadedLead: null,
      loadedThread: null,
      threadQueryPending: true,
    });
    assert.equal(state.canCompose, false);
    assert.equal(state.showLoading, true);
    assert.equal(state.headerName, "Thetis C.");
    assert.equal(state.destinationPhone, "13129221025");
  });

  it("blocks send when Thetis row is selected but adjuster thread is loaded", () => {
    const state = resolveThreadSync({
      selectedLeadId: thetis.id,
      selectedRowPhone: thetis.phone_e164,
      selectedRowName: thetis.name,
      loadedLead: adjuster,
      loadedThread: adjusterThread,
      threadQueryPending: false,
    });
    assert.equal(state.canCompose, false);
    assert.equal(state.inSync, false);
    assert.equal(state.headerName, "Thetis C.");
    assert.equal(state.destinationPhone, "13129221025");
    assert.match(state.blockReason ?? "", /does not match|reloading|belong/i);
  });

  it("blocks when loaded lead id matches but phone does not match the clicked row", () => {
    const state = resolveThreadSync({
      selectedLeadId: thetis.id,
      selectedRowPhone: thetis.phone_e164,
      selectedRowName: thetis.name,
      loadedLead: { ...thetis, phone_e164: adjuster.phone_e164 },
      loadedThread: { ...thetisThread, phone_e164: adjuster.phone_e164 },
      threadQueryPending: false,
    });
    assert.equal(state.canCompose, false);
    assert.match(state.blockReason ?? "", /phone/i);
  });

  it("enables compose only when row phone and loaded thread phone match", () => {
    const state = resolveThreadSync({
      selectedLeadId: floyd.id,
      selectedRowPhone: floyd.phone_e164,
      selectedRowName: floyd.name,
      loadedLead: floyd,
      loadedThread: floydThread,
      threadQueryPending: false,
    });
    assert.equal(state.canCompose, true);
    assert.equal(state.inSync, true);
    assert.equal(state.destinationPhone, "13125550111");
    assert.equal(state.headerName, "Floyd");
  });
});

describe("assertSendDestination", () => {
  it("refuses sending to adjuster when Thetis row was clicked", () => {
    const result = assertSendDestination({
      selectedLeadId: thetis.id,
      selectedRowPhone: thetis.phone_e164!,
      loadedLeadId: adjuster.id,
      loadedThreadId: adjusterThread.id,
      loadedThreadLeadId: adjuster.id,
      destinationPhone: adjuster.phone_e164!,
      headerPhone: thetis.phone_e164!,
    });
    assert.equal(result.ok, false);
  });

  it("allows send only when selection, thread, and header phone agree", () => {
    const result = assertSendDestination({
      selectedLeadId: floyd.id,
      selectedRowPhone: floyd.phone_e164!,
      loadedLeadId: floyd.id,
      loadedThreadId: floydThread.id,
      loadedThreadLeadId: floyd.id,
      destinationPhone: floyd.phone_e164!,
      headerPhone: floyd.phone_e164!,
    });
    assert.deepEqual(result, { ok: true });
  });

  it("blocks when destination phone does not match visible header", () => {
    const result = assertSendDestination({
      selectedLeadId: floyd.id,
      selectedRowPhone: floyd.phone_e164!,
      loadedLeadId: floyd.id,
      loadedThreadId: floydThread.id,
      loadedThreadLeadId: floyd.id,
      destinationPhone: thetis.phone_e164!,
      headerPhone: floyd.phone_e164!,
    });
    assert.equal(result.ok, false);
  });
});

describe("displayPhone", () => {
  it("formats Thetis destination for the header", () => {
    assert.equal(displayPhone("+13129221025"), "+1 (312) 922-1025");
  });
});
