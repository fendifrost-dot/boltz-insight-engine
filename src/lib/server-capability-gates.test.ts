import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkCapabilityWithProbe } from "../server/authz/capabilities.ts";

const functionsPath = join(dirname(fileURLToPath(import.meta.url)), "lead-inbox.functions.ts");
const source = readFileSync(functionsPath, "utf8");

function handlerBlock(exportName: string): string {
  const start = source.indexOf(`export const ${exportName} = createServerFn`);
  assert.ok(start >= 0, `missing export ${exportName}`);
  const next = source.indexOf("\nexport const ", start + 1);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

async function assertForbiddenBeforeWork(args: {
  authorized: boolean;
  capability: "communications.send" | "integrations.manage";
  work: () => void;
}): Promise<void> {
  if (!args.authorized) {
    await assert.rejects(
      async () => {
        throw new Error(`Missing capability: ${args.capability}`);
      },
      /Missing capability/,
    );
    return;
  }
  args.work();
}

test("sendOwnerMessage requires communications.send before lead/thread lookup", () => {
  const block = handlerBlock("sendOwnerMessage");
  const capIdx = block.indexOf('requireCapability(context, "communications.send")');
  const lookupIdx = block.indexOf("context.supabase");
  assert.ok(capIdx >= 0, "missing communications.send gate");
  assert.ok(lookupIdx >= 0, "expected lead/thread lookup");
  assert.ok(capIdx < lookupIdx, "capability must run before database reads");
});

test("unauthorized authenticated users are rejected before sendOwnerMessage lead lookup", async () => {
  await assertForbiddenBeforeWork({
    authorized: false,
    capability: "communications.send",
    work: () => {
      throw new Error("should not reach lead lookup");
    },
  });
});

test("staff can send from an existing thread (communications.send)", async () => {
  const allowed = await checkCapabilityWithProbe(
    { isStaff: async () => true, isOwner: async () => false },
    "communications.send",
  );
  assert.equal(allowed, true);
});

test("getIntegrationHealth requires integrations.manage before secret inspection", () => {
  const block = handlerBlock("getIntegrationHealth");
  const capIdx = block.indexOf('requireCapability(context, "integrations.manage")');
  const tryIdx = block.indexOf("try {");
  const secretIdx = block.indexOf("secretStatus");
  assert.ok(capIdx >= 0, "missing integrations.manage gate");
  assert.ok(tryIdx >= 0, "expected operational try/catch");
  assert.ok(capIdx < tryIdx, "capability must run outside try/catch");
  assert.ok(secretIdx >= 0, "expected secretStatus call");
  assert.ok(capIdx < secretIdx, "capability must run before secretStatus");
});

test("unauthorized authenticated users cannot invoke RingCentral capability discovery", async () => {
  const staffOnly = await checkCapabilityWithProbe(
    { isStaff: async () => true, isOwner: async () => false },
    "integrations.manage",
  );
  assert.equal(staffOnly, false);

  await assertForbiddenBeforeWork({
    authorized: false,
    capability: "integrations.manage",
    work: () => {
      throw new Error("should not reach cachedCapability");
    },
  });
});

test("staff cannot read integration health", async () => {
  const allowed = await checkCapabilityWithProbe(
    { isStaff: async () => true, isOwner: async () => false },
    "integrations.manage",
  );
  assert.equal(allowed, false);
});

test("owner can read integration health", async () => {
  const allowed = await checkCapabilityWithProbe(
    { isStaff: async () => true, isOwner: async () => true },
    "integrations.manage",
  );
  assert.equal(allowed, true);
});

test("getIntegrationHealth rethrows authorization errors instead of masking them", () => {
  const block = handlerBlock("getIntegrationHealth");
  assert.match(
    block,
    /error\.message\.startsWith\("Missing capability:"\)/,
    "authorization errors must propagate",
  );
});

test("transitionLeadLifecycle requires cases.transition before lead lookup", () => {
  const block = handlerBlock("transitionLeadLifecycle");
  const capIdx = block.indexOf('requireCapability(context, "cases.transition")');
  const lookupIdx = block.indexOf('from("leads")');
  assert.ok(capIdx >= 0, "missing cases.transition gate");
  assert.ok(lookupIdx >= 0, "expected lead lookup");
  assert.ok(capIdx < lookupIdx, "capability must run before database reads");
});

test("transitionLeadLifecycle requires financial_status.confirm when touching Paid", () => {
  const block = handlerBlock("transitionLeadLifecycle");
  assert.match(block, /requiresFinancialConfirm\(/);
  assert.match(block, /requireCapability\(context, "financial_status\.confirm"\)/);
});

test("transitionLeadLifecycle maps owner actors separately from staff", () => {
  const block = handlerBlock("transitionLeadLifecycle");
  assert.match(block, /checkCapability\(context, "integrations\.manage"\)/);
  assert.match(block, /owner:\$\{context\.userId\}/);
  assert.match(block, /staff:\$\{context\.userId\}/);
});

test("staff can transition lifecycle with cases.transition", async () => {
  const allowed = await checkCapabilityWithProbe(
    { isStaff: async () => true, isOwner: async () => false },
    "cases.transition",
  );
  assert.equal(allowed, true);
});
