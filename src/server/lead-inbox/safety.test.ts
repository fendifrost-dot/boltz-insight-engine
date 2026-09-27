import test from "node:test";
import assert from "node:assert/strict";
import { OUTBOUND_MAX_LENGTH, describeOutboundBlock, validateOutbound } from "./safety.server.ts";

test("a plain first text to a web-form lead passes", () => {
  const text =
    "Hi Daquame, this is Boltz Auto. Thanks for the form about your 2012 VW CC. We'd need to inspect it before quoting the engine oil work. Does 10-11 AM work for a drop-off? Reply STOP to opt out.";
  assert.deepEqual(validateOutbound(text), { ok: true, tags: [], problems: [] });
});

test("negated guarantee / free-service wording is not treated as a promise", () => {
  for (const text of [
    "We can't guarantee a price until we inspect it.",
    "We can’t guarantee anything over text.",
    "I cannot guarantee timing without seeing the car.",
    "There's no guarantee it's the cylinder until we look.",
    "Heads up, it's not a free diagnostic.",
  ]) {
    assert.equal(validateOutbound(text).ok, true, text);
  }
});

test("real promises are still blocked", () => {
  const cases: [string, string][] = [
    ["We guarantee the fix.", "guarantee_language"],
    ["Guaranteed same-day turnaround!", "guarantee_language"],
    ["Bring it in for a free diagnostic.", "free_service_promise"],
    ["No worries, free tow included.", "free_service_promise"],
    ["Take 15% off this week.", "discount_promise"],
    ["We're open Sunday.", "hours_misstatement"],
    ["Lifetime warranty on all work.", "warranty_promise"],
  ];
  for (const [text, tag] of cases) {
    const check = validateOutbound(text);
    assert.equal(check.ok, false, text);
    assert.ok(check.tags.includes(tag), `${text} -> ${check.tags.join(",")}`);
  }
});

test("a later un-negated promise is caught even after a negated one", () => {
  const check = validateOutbound("We can't guarantee a price, but we guarantee the work.");
  assert.deepEqual(check.tags, ["guarantee_language"]);
});

test("block reason names the offending phrase and the length", () => {
  const check = validateOutbound(`We guarantee it. ${"x".repeat(OUTBOUND_MAX_LENGTH)}`);
  const reason = describeOutboundBlock(check);
  assert.match(reason, /^Blocked by outbound policy validation/);
  assert.match(reason, /"guarantee" \(guarantee_language\)/);
  assert.match(reason, /\d+ characters; the limit is 480/);
});
