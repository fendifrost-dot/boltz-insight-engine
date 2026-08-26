import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSendDestination,
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

describe("resolveThreadSync", () => {
  it("blocks compose while the selected thread is still loading", () => {
    const state = resolveThreadSync({
      selectedLeadId: floyd.id,
      loadedLead: thetis,
      loadedThread: thetisThread,
      threadQueryPending: true,
    });
    assert.equal(state.canCompose, false);
    assert.equal(state.showLoading, true);
    assert.equal(state.inSync, false);
  });

  it("blocks send when highlighted row A still has conversation B loaded (P0 desync)", () => {
    const state = resolveThreadSync({
      selectedLeadId: floyd.id,
      loadedLead: thetis,
      loadedThread: thetisThread,
      threadQueryPending: false,
    });
    assert.equal(state.canCompose, false);
    assert.equal(state.showLoading, true);
    assert.match(state.blockReason ?? "", /disagree/i);
    assert.equal(state.destinationPhone, null);
  });

  it("enables compose only when highlight and loaded header match", () => {
    const state = resolveThreadSync({
      selectedLeadId: floyd.id,
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
  it("refuses sending to B when selection is A", () => {
    const result = assertSendDestination({
      selectedLeadId: floyd.id,
      loadedLeadId: thetis.id,
      loadedThreadId: thetisThread.id,
      loadedThreadLeadId: thetis.id,
      destinationPhone: thetis.phone_e164!,
      headerPhone: thetis.phone_e164!,
    });
    assert.equal(result.ok, false);
  });

  it("allows send only when selection, thread, and header phone agree", () => {
    const result = assertSendDestination({
      selectedLeadId: floyd.id,
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
      loadedLeadId: floyd.id,
      loadedThreadId: floydThread.id,
      loadedThreadLeadId: floyd.id,
      destinationPhone: thetis.phone_e164!,
      headerPhone: floyd.phone_e164!,
    });
    assert.equal(result.ok, false);
  });
});
