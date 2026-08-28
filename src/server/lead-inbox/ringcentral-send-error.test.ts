import test from "node:test";
import assert from "node:assert/strict";
import {
  RingCentralSendError,
  classifyRingCentralHttpFailure,
  isAmbiguousSendError,
} from "./ringcentral-send-error.ts";

test("classifyRingCentralHttpFailure treats 4xx as confirmed rejection except 429", () => {
  assert.equal(classifyRingCentralHttpFailure(400), "confirmed_rejection");
  assert.equal(classifyRingCentralHttpFailure(403), "confirmed_rejection");
  assert.equal(classifyRingCentralHttpFailure(429), "ambiguous");
  assert.equal(classifyRingCentralHttpFailure(503), "ambiguous");
});

test("isAmbiguousSendError recognizes network and timeout failures", () => {
  assert.equal(isAmbiguousSendError(new TypeError("fetch failed")), true);
  assert.equal(isAmbiguousSendError(new RingCentralSendError("timeout", "ambiguous")), true);
  assert.equal(
    isAmbiguousSendError(new RingCentralSendError("bad request", "confirmed_rejection", 400)),
    false,
  );
});
