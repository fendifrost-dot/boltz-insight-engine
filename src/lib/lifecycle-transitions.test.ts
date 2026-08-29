import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AGENT_INTAKE_STAGES,
  GROK_RECOMMENDED_TERMINAL,
  LIFECYCLE_FUNNEL,
  buildLifecycleEvidenceMetadata,
  isAllowedLifecycleTransition,
  requiresFinancialConfirm,
  resolveTransitionActorKind,
  validateLifecycleEvidence,
  validateLifecycleTransition,
} from "./lifecycle-transitions.ts";

const jobsPath = join(dirname(fileURLToPath(import.meta.url)), "../server/lead-inbox/jobs.server.ts");

const grokEvidence = {
  basis: "agent_decision" as const,
  agentRunId: "run-1",
  inboundMessageId: "msg-1",
};

const staffEvidence = (basis: "appointment_record", ref: string) => ({
  basis,
  evidenceRef: ref,
  assertedBy: "staff-1",
});

test("grok may advance only New to Contacted and Contacted to Qualified", () => {
  assert.equal(
    isAllowedLifecycleTransition({ from: "New", to: "Contacted", actor: "grok" }),
    true,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Contacted", to: "Qualified", actor: "grok" }),
    true,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Qualified", to: "Appointment Scheduled", actor: "grok" }),
    false,
  );
});

test("grok may not skip funnel steps, enter operational stages, or execute terminal states", () => {
  assert.equal(
    isAllowedLifecycleTransition({ from: "New", to: "Qualified", actor: "grok" }),
    false,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Contacted", to: "Paid", actor: "grok" }),
    false,
  );

  for (const from of AGENT_INTAKE_STAGES) {
    for (const to of GROK_RECOMMENDED_TERMINAL) {
      assert.equal(
        isAllowedLifecycleTransition({ from, to, actor: "grok" }),
        false,
        `grok must not execute ${from} → ${to}`,
      );
      const rejected = validateLifecycleTransition({
        from,
        to,
        actor: "grok",
        evidence: grokEvidence,
      });
      assert.equal(rejected.ok, false, `grok must reject ${from} → ${to}`);
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

test("staff may move adjacent funnel steps and to terminal states but never Paid", () => {
  assert.equal(
    isAllowedLifecycleTransition({ from: "Qualified", to: "Appointment Scheduled", actor: "staff" }),
    true,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "In Progress", to: "Lost", actor: "staff" }),
    true,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Completed", to: "Paid", actor: "staff" }),
    false,
  );
  assert.equal(
    isAllowedLifecycleTransition({ from: "Paid", to: "Completed", actor: "staff" }),
    false,
  );
});

test("staff cannot mark Completed as Paid with staff_observation only", () => {
  const result = validateLifecycleTransition({
    from: "Completed",
    to: "Paid",
    actor: "staff",
    evidence: {
      basis: "staff_observation",
      assertedBy: "staff-1",
    },
  });
  assert.equal(result.ok, false);
});

test("owner may mark Completed as Paid only with payment_record and evidence_ref", () => {
  const missingRef = validateLifecycleTransition({
    from: "Completed",
    to: "Paid",
    actor: "owner",
    evidence: {
      basis: "payment_record",
      assertedBy: "owner-1",
    },
  });
  assert.equal(missingRef.ok, false);
  if (!missingRef.ok) assert.match(missingRef.reason, /evidence_ref/i);

  const ok = validateLifecycleTransition({
    from: "Completed",
    to: "Paid",
    actor: "owner",
    evidence: {
      basis: "payment_record",
      evidenceRef: "invoice-2026-1182",
      assertedBy: "owner-1",
    },
  });
  assert.equal(ok.ok, true);
});

test("owner may revert Paid to Completed only with manual_correction evidence", () => {
  const ok = validateLifecycleTransition({
    from: "Paid",
    to: "Completed",
    actor: "owner",
    evidence: {
      basis: "manual_correction",
      evidenceRef: "payment-reversal-42",
      assertedBy: "owner-1",
      note: "Charge reversed in QuickBooks",
    },
  });
  assert.equal(ok.ok, true);

  const staffBlocked = validateLifecycleTransition({
    from: "Paid",
    to: "Completed",
    actor: "staff",
    evidence: {
      basis: "manual_correction",
      evidenceRef: "payment-reversal-42",
      assertedBy: "staff-1",
    },
  });
  assert.equal(staffBlocked.ok, false);
});

test("requiresFinancialConfirm covers any transition touching Paid", () => {
  assert.equal(requiresFinancialConfirm("Completed", "Paid"), true);
  assert.equal(requiresFinancialConfirm("Paid", "Completed"), true);
  assert.equal(requiresFinancialConfirm("Qualified", "Appointment Scheduled"), false);
});

test("destination-specific evidence is required for operational funnel stages", () => {
  const appointmentOk = validateLifecycleTransition({
    from: "Qualified",
    to: "Appointment Scheduled",
    actor: "staff",
    evidence: staffEvidence("appointment_record", "appt-42"),
  });
  assert.equal(appointmentOk.ok, true);

  const appointmentWrongBasis = validateLifecycleTransition({
    from: "Qualified",
    to: "Appointment Scheduled",
    actor: "staff",
    evidence: {
      basis: "staff_observation",
      assertedBy: "staff-1",
    },
  });
  assert.equal(appointmentWrongBasis.ok, false);

  const inspectedOk = validateLifecycleTransition({
    from: "Appointment Scheduled",
    to: "Inspected",
    actor: "staff",
    evidence: {
      basis: "inspection_record",
      evidenceRef: "insp-9",
      assertedBy: "staff-1",
    },
  });
  assert.equal(inspectedOk.ok, true);

  const estimateOk = validateLifecycleTransition({
    from: "Inspected",
    to: "Estimate Sent",
    actor: "staff",
    evidence: {
      basis: "estimate_record",
      evidenceRef: "est-77",
      assertedBy: "staff-1",
    },
  });
  assert.equal(estimateOk.ok, true);

  const approvedOk = validateLifecycleTransition({
    from: "Estimate Sent",
    to: "Approved",
    actor: "staff",
    evidence: {
      basis: "customer_message",
      evidenceRef: "sms-thread-12",
      assertedBy: "staff-1",
    },
  });
  assert.equal(approvedOk.ok, true);
});

test("resolveTransitionActorKind maps owner and staff separately", () => {
  assert.equal(resolveTransitionActorKind("owner:abc"), "owner");
  assert.equal(resolveTransitionActorKind("staff:abc"), "staff");
  assert.equal(resolveTransitionActorKind("grok"), "grok");
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
    evidence: grokEvidence,
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
  assert.equal(metadata["basis"], "agent_decision");
  assert.equal(metadata["agent_run_id"], "run-1");
  assert.equal(metadata["inbound_message_id"], "msg-1");
  assert.equal(metadata["at"], "2026-08-28T00:00:00.000Z");
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
