import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AGENT_INTAKE_STAGES,
  AGENT_TERMINAL,
  LIFECYCLE_FUNNEL,
  buildLifecycleEvidenceMetadata,
  isAllowedLifecycleTransition,
  validateLifecycleEvidence,
  validateLifecycleTransition,
} from "./lifecycle-transitions.ts";

const jobsPath = join(dirname(fileURLToPath(import.meta.url)), "../server/lead-inbox/jobs.server.ts");

test("grok may advance one intake funnel step", () => {
  assert.equal(
    isAllowedLifecycleTransition({ from: "New", to: "Contacted", actor: "grok" }),
    true,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Contacted", to: "Qualified", actor: "grok" }),
    true,
  );
});

test("grok may not skip funnel steps or enter operational stages", () => {
  assert.equal(
    isAllowedLifecycleTransition({ from: "New", to: "Qualified", actor: "grok" }),
    false,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Qualified", to: "Appointment Scheduled", actor: "grok" }),
    false,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Contacted", to: "Paid", actor: "grok" }),
    false,
  );
});

test("grok may move early intake leads to agent terminal states", () => {
  for (const from of AGENT_INTAKE_STAGES) {
    for (const to of AGENT_TERMINAL) {
      assert.equal(isAllowedLifecycleTransition({ from, to, actor: "grok" }), true, `${from} → ${to}`);
    }
  }
});

test("grok may not transition from post-intake funnel stages", () => {
  for (const from of LIFECYCLE_FUNNEL.slice(3)) {
    assert.equal(
      isAllowedLifecycleTransition({ from, to: "Lost", actor: "grok" }),
      false,
      `${from} → Lost should be blocked`,
    );
  }
});

test("staff may move adjacent funnel steps and to terminal states", () => {
  assert.equal(
    isAllowedLifecycleTransition({ from: "Qualified", to: "Appointment Scheduled", actor: "staff" }),
    true,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Appointment Scheduled", to: "Qualified", actor: "staff" }),
    true,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "In Progress", to: "Lost", actor: "staff" }),
    true,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Lost", to: "Contacted", actor: "staff" }),
    true,
  );
});

test("staff may not skip funnel steps", () => {
  assert.equal(
    isAllowedLifecycleTransition({ from: "New", to: "Qualified", actor: "staff" }),
    false,
  );
});

test("agent lifecycle transitions require agent_decision evidence", () => {
  const missingRun = validateLifecycleTransition({
    from: "New",
    to: "Contacted",
    actor: "grok",
    evidence: {
      basis: "agent_decision",
      inboundMessageId: "msg-1",
    },
  });
  assert.equal(missingRun.ok, false);
  if (!missingRun.ok) assert.match(missingRun.reason, /agent_run_id/i);

  const ok = validateLifecycleTransition({
    from: "New",
    to: "Contacted",
    actor: "grok",
    evidence: {
      basis: "agent_decision",
      agentRunId: "run-1",
      inboundMessageId: "msg-1",
      note: "Customer replied with vehicle details",
    },
  });
  assert.equal(ok.ok, true);
});

test("staff lifecycle transitions require asserted_by user id", () => {
  const rejected = validateLifecycleTransition({
    from: "Qualified",
    to: "Appointment Scheduled",
    actor: "staff",
    evidence: {
      basis: "appointment_record",
      evidenceRef: "appt-42",
    },
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.reason, /asserted_by/i);

  const ok = validateLifecycleTransition({
    from: "Qualified",
    to: "Appointment Scheduled",
    actor: "staff",
    evidence: {
      basis: "appointment_record",
      evidenceRef: "appt-42",
      assertedBy: "user-staff",
    },
  });
  assert.equal(ok.ok, true);
});

test("buildLifecycleEvidenceMetadata records audit fields", () => {
  const metadata = buildLifecycleEvidenceMetadata(
    {
      basis: "agent_decision",
      agentRunId: "run-1",
      inboundMessageId: "msg-1",
      note: "Vehicle intake complete",
    },
    "2026-08-28T00:00:00.000Z",
  );
  assert.equal(metadata.basis, "agent_decision");
  assert.equal(metadata.agent_run_id, "run-1");
  assert.equal(metadata.inbound_message_id, "msg-1");
  assert.equal(metadata.at, "2026-08-28T00:00:00.000Z");
});

test("validateLifecycleEvidence rejects agent_decision basis for staff actor", () => {
  const result = validateLifecycleEvidence({
    actor: "staff",
    evidence: {
      basis: "agent_decision",
      assertedBy: "user-1",
    },
  });
  assert.equal(result.ok, false);
});

test("jobs.server applies lifecycle through gated transition service", () => {
  const source = readFileSync(jobsPath, "utf8");
  assert.match(source, /applyLifecycleTransition\(/);
  assert.doesNotMatch(source, /\.from\("leads"\)\.update\(\{ lifecycle:/);
});

test("lifecycle.server uses atomic RPC instead of separate update and event insert", () => {
  const lifecycleServerPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../server/lead-inbox/lifecycle.server.ts",
  );
  const source = readFileSync(lifecycleServerPath, "utf8");
  assert.match(source, /rpc\("apply_lead_lifecycle_transition"/);
  assert.doesNotMatch(source, /addEvent\(/);
  assert.match(source, /code: "stale"/);
});
