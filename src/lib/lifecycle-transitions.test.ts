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
  canonicalLifecycle,
  isAllowedLifecycleTransition,
  lifecycleValuesMessage,
  outboundMessageSupportsContact,
  requiresFinancialConfirm,
  resolveTransitionActorKind,
  validateLifecycleEvidence,
  validateLifecycleTransition,
} from "./lifecycle-transitions.ts";

const jobsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../server/lead-inbox/jobs.server.ts",
);

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
  assert.equal(isAllowedLifecycleTransition({ from: "New", to: "Contacted", actor: "grok" }), true);
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
    isAllowedLifecycleTransition({
      from: "Qualified",
      to: "Appointment Scheduled",
      actor: "staff",
    }),
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
  assert.equal(resolveTransitionActorKind("staff:mcp:lead-follow-up"), "staff");
  assert.equal(resolveTransitionActorKind("grok"), "grok");
  assert.equal(resolveTransitionActorKind("system"), "system");
});

test("system may mark an open funnel lead Paid from a Square payment record", () => {
  const paid = validateLifecycleTransition({
    from: "New",
    to: "Paid",
    actor: "system",
    evidence: { basis: "payment_record", evidenceRef: "sq-payment-1" },
  });
  assert.equal(paid.ok, true);

  const fromEstimate = validateLifecycleTransition({
    from: "Estimate Sent",
    to: "Paid",
    actor: "system",
    evidence: { basis: "payment_record", evidenceRef: "sq-payment-2" },
  });
  assert.equal(fromEstimate.ok, true);
});

test("system cannot mark Paid without a payment record, and cannot mark a terminal lead", () => {
  const wrongBasis = validateLifecycleTransition({
    from: "Completed",
    to: "Paid",
    actor: "system",
    evidence: { basis: "system_rule", evidenceRef: "rule-1" },
  });
  assert.equal(wrongBasis.ok, false);

  const terminal = validateLifecycleTransition({
    from: "Spam",
    to: "Paid",
    actor: "system",
    evidence: { basis: "payment_record", evidenceRef: "sq-payment-3" },
  });
  assert.equal(terminal.ok, false);

  const staff = validateLifecycleTransition({
    from: "Completed",
    to: "Paid",
    actor: "staff",
    evidence: { basis: "payment_record", evidenceRef: "sq-payment-4", assertedBy: "staff-1" },
  });
  assert.equal(staff.ok, false);
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
  const helperPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../server/lead-inbox/lifecycle-rpc.ts",
  );
  const source = readFileSync(lifecycleServerPath, "utf8");
  const helper = readFileSync(helperPath, "utf8");
  assert.match(helper, /client\.rpc\("apply_lead_lifecycle_transition"/);
  assert.match(source, /callApplyLeadLifecycleTransition\(\s*supabaseAdmin/);
  assert.doesNotMatch(source, /const rpc = supabaseAdmin\.rpc/);
  assert.doesNotMatch(source, /addEvent\(/);
  assert.match(source, /code: "stale"/);
});

test("lifecycle rpc keeps the supabase client as this", async () => {
  const { callApplyLeadLifecycleTransition } =
    await import("../server/lead-inbox/lifecycle-rpc.ts");
  let seenMarker = "";
  const client = {
    marker: "client",
    rpc(this: { marker: string }, fn: string) {
      seenMarker = this.marker;
      assert.equal(fn, "apply_lead_lifecycle_transition");
      return Promise.resolve({
        data: { status: "applied", from: "New", to: "Contacted" },
        error: null,
      });
    },
  };
  await callApplyLeadLifecycleTransition(client, { _lead_id: "lead-1" });
  assert.equal(seenMarker, "client");
});

test("stage names match without case, and unknown names list the real stages", () => {
  assert.equal(canonicalLifecycle("contacted"), "Contacted");
  assert.equal(canonicalLifecycle("  appointment scheduled "), "Appointment Scheduled");
  assert.equal(canonicalLifecycle("NO-SHOW"), "No-show");
  assert.equal(canonicalLifecycle("nope"), null);
  assert.match(lifecycleValuesMessage(), /Contacted/);
  assert.match(lifecycleValuesMessage(), /case-insensitive/);
});

test("outbound SMS evidence moves New to Contacted and cannot skip or mark Paid", () => {
  const contacted = validateLifecycleTransition({
    from: "New",
    to: "Contacted",
    actor: "system",
    evidence: { basis: "outbound_sms", evidenceRef: "60e782ac-953f-407a-a414-a41addbee307" },
  });
  assert.equal(contacted.ok, true);

  const staff = validateLifecycleTransition({
    from: "New",
    to: "Contacted",
    actor: "staff",
    evidence: {
      basis: "outbound_sms",
      evidenceRef: "60e782ac-953f-407a-a414-a41addbee307",
      assertedBy: "staff-1",
    },
  });
  assert.equal(staff.ok, true);

  const missingRef = validateLifecycleTransition({
    from: "New",
    to: "Contacted",
    actor: "staff",
    evidence: { basis: "outbound_sms", assertedBy: "staff-1" },
  });
  assert.equal(missingRef.ok, false);
  if (!missingRef.ok) assert.match(missingRef.reason, /evidence_ref/);

  const systemRule = validateLifecycleTransition({
    from: "New",
    to: "Contacted",
    actor: "system",
    evidence: { basis: "system_rule", evidenceRef: "rule-1" },
  });
  assert.equal(systemRule.ok, false);

  const skipped = validateLifecycleTransition({
    from: "Qualified",
    to: "Appointment Scheduled",
    actor: "staff",
    evidence: {
      basis: "outbound_sms",
      evidenceRef: "60e782ac-953f-407a-a414-a41addbee307",
      assertedBy: "staff-1",
    },
  });
  assert.equal(skipped.ok, false);
  if (!skipped.ok) assert.match(skipped.reason, /only supports a move to Contacted/);

  const paid = validateLifecycleTransition({
    from: "Completed",
    to: "Paid",
    actor: "staff",
    evidence: {
      basis: "outbound_sms",
      evidenceRef: "60e782ac-953f-407a-a414-a41addbee307",
      assertedBy: "staff-1",
    },
  });
  assert.equal(paid.ok, false);

  const systemPaid = validateLifecycleTransition({
    from: "New",
    to: "Paid",
    actor: "system",
    evidence: { basis: "outbound_sms", evidenceRef: "60e782ac-953f-407a-a414-a41addbee307" },
  });
  assert.equal(systemPaid.ok, false);
});

test("a failed or foreign message does not count as contact evidence", () => {
  const messageId = "60e782ac-953f-407a-a414-a41addbee307";
  assert.equal(
    outboundMessageSupportsContact({
      leadId: "lead-1",
      messageLeadId: "lead-1",
      direction: "outbound",
      deliveryState: "queued",
    }),
    true,
  );
  assert.equal(
    outboundMessageSupportsContact({
      leadId: "lead-1",
      messageLeadId: "lead-1",
      direction: "outbound",
      deliveryState: "failed",
    }),
    false,
  );
  assert.equal(
    outboundMessageSupportsContact({
      leadId: "lead-1",
      messageLeadId: "lead-2",
      direction: "outbound",
      deliveryState: "sent",
    }),
    false,
  );
  assert.equal(messageId.length > 0, true);
});

test("bot SMS backfill moves only New leads that a bot already texted", () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../supabase/migrations/20261014160000_contacted_after_bot_sms.sql",
    ),
    "utf8",
  );
  assert.match(sql, /lifecycle = 'New'::public\.lead_lifecycle/);
  assert.match(sql, /'Contacted'::public\.lead_lifecycle/);
  assert.match(sql, /e\.actor LIKE 'bot:%'/);
  assert.match(sql, /delivery_state IS DISTINCT FROM 'failed'/);
  assert.match(sql, /apply_lead_lifecycle_transition/);
  assert.match(sql, /'outbound_sms'/);
  assert.doesNotMatch(sql, /'Paid'/);
  assert.doesNotMatch(sql, /DELETE FROM/i);
});
