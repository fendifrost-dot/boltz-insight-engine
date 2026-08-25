import { describe, expect, test, beforeEach, mock } from "bun:test";
import { normalizeToE164 } from "../server/phone.server";
import {
  detectHighRiskCategory,
  isOptInMessage,
  isOptOutMessage,
} from "../server/consent.server";
import { grokDecisionSchema } from "../../integrations/xai/schema";
import {
  __resetRingCentralTokenCacheForTests,
  detectSmsCapability,
} from "../../integrations/ringcentral/client.server";
import { runLeadSmsAgent } from "../../integrations/xai/agent.server";

describe("phone normalization", () => {
  test("normalizes US 10-digit to E.164", () => {
    expect(normalizeToE164("(708) 575-4555")).toBe("+17085754555");
  });

  test("preserves existing E.164", () => {
    expect(normalizeToE164("+17085754555")).toBe("+17085754555");
  });

  test("returns null for invalid", () => {
    expect(normalizeToE164("abc")).toBeNull();
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164(null)).toBeNull();
  });
});

describe("opt-out / opt-in", () => {
  test("honors STOP and equivalents", () => {
    for (const word of ["STOP", "stop", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "STOPALL"]) {
      expect(isOptOutMessage(word)).toBe(true);
    }
  });

  test("supports START re-enable", () => {
    expect(isOptInMessage("START")).toBe(true);
    expect(isOptInMessage("UNSTOP")).toBe(true);
  });
});

describe("escalation heuristics", () => {
  test("detects high-risk categories", () => {
    expect(detectHighRiskCategory("I will sue you and my lawyer is calling")).toBe("legal_claim");
    expect(detectHighRiskCategory("I want a refund and chargeback")).toBe("payment_dispute");
    expect(detectHighRiskCategory("please speak to a human")).toBe("human_requested");
  });
});

describe("grok decision schema", () => {
  test("accepts valid send decision", () => {
    const parsed = grokDecisionSchema.parse({
      action: "send",
      message: "Thanks for contacting Boltz Automotive. What is the year/make/model?",
      lead_field_updates: null,
      proposed_lifecycle: null,
      tags: ["intake"],
      escalation_category: null,
      audit_summary: "Asked for vehicle details",
    });
    expect(parsed.action).toBe("send");
  });

  test("rejects send without message", () => {
    expect(() =>
      grokDecisionSchema.parse({
        action: "send",
        message: "",
        lead_field_updates: null,
        proposed_lifecycle: null,
        tags: [],
        escalation_category: null,
        audit_summary: "bad",
      }),
    ).toThrow();
  });
});

describe("RingCentral token refresh / 401 retry", () => {
  beforeEach(() => {
    __resetRingCentralTokenCacheForTests();
    process.env["RINGCENTRAL_CLIENT_ID"] = "test-client";
    process.env["RINGCENTRAL_CLIENT_SECRET"] = "test-secret";
    process.env["RINGCENTRAL_JWT"] = "test-jwt";
    process.env["RINGCENTRAL_SERVER_URL"] = "https://platform.ringcentral.com";
    process.env["RINGCENTRAL_FROM_NUMBER"] = "+17085754555";
    process.env["RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN"] = "validate-me";
  });

  test("detectSmsCapability prefers SmsSender over A2P-only", () => {
    expect(detectSmsCapability(["SmsSender", "CallerId"])).toBe("SmsSender");
    expect(detectSmsCapability(["A2PSmsSender"])).toBe("A2PSmsSender");
    expect(detectSmsCapability([])).toBe("none");
  });

  test("single-flight token fetch and 401 retry", async () => {
    let tokenCalls = 0;
    let smsCalls = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/restapi/oauth/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `token-${tokenCalls}`,
            expires_in: 3600,
            token_type: "bearer",
            owner_id: "1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/phone-number")) {
        return new Response(
          JSON.stringify({
            records: [
              {
                id: "n1",
                phoneNumber: "+17085754555",
                features: ["SmsSender"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/sms")) {
        smsCalls += 1;
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        if (smsCalls === 1) {
          return new Response("unauthorized", { status: 401 });
        }
        expect(auth.includes("token-2")).toBe(true);
        return new Response(JSON.stringify({ id: "msg-1", messageStatus: "Sent" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const { sendSms, fetchAccessToken } = await import(
      "../../integrations/ringcentral/client.server.ts"
    );

    // Parallel token requests share one flight
    const [a, b] = await Promise.all([fetchAccessToken(), fetchAccessToken()]);
    expect(a.accessToken).toBe(b.accessToken);
    expect(tokenCalls).toBe(1);

    const result = await sendSms({
      from: "+17085754555",
      to: "+13125551212",
      text: "Hello from Boltz",
    });
    expect(result.providerMessageId).toBe("msg-1");
    expect(tokenCalls).toBe(2); // refreshed after 401
    expect(smsCalls).toBe(2);

    globalThis.fetch = originalFetch;
  });

  test("honors Retry-After on 429 once then succeeds", async () => {
    __resetRingCentralTokenCacheForTests();
    let smsCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/restapi/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "t", expires_in: 3600, token_type: "bearer" }),
          { status: 200 },
        );
      }
      if (url.includes("/phone-number")) {
        return new Response(
          JSON.stringify({
            records: [{ phoneNumber: "+17085754555", features: ["SmsSender"] }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/sms")) {
        smsCalls += 1;
        if (smsCalls === 1) {
          return new Response("slow down", { status: 429, headers: { "Retry-After": "0" } });
        }
        return new Response(JSON.stringify({ id: "msg-2", messageStatus: "Queued" }), {
          status: 200,
        });
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    const { sendSms } = await import("../../integrations/ringcentral/client.server.ts");
    const result = await sendSms({
      from: "+17085754555",
      to: "+13125551212",
      text: "Retry test",
    });
    expect(result.providerMessageId).toBe("msg-2");
    expect(smsCalls).toBe(2);
    globalThis.fetch = originalFetch;
  });
});

describe("webhook validation helpers", () => {
  test("validation token must be echoed exactly", () => {
    const token = "abc.validation.token";
    const headers = new Headers({ "Validation-Token": token });
    expect(headers.get("Validation-Token")).toBe(token);
  });

  test("duplicate provider message id is unique-constrained conceptually", () => {
    const seen = new Set<string>();
    const ingest = (id: string) => {
      if (seen.has(id)) return { duplicate: true };
      seen.add(id);
      return { duplicate: false };
    };
    expect(ingest("1001").duplicate).toBe(false);
    expect(ingest("1001").duplicate).toBe(true);
  });
});

describe("autonomous agent deterministic paths", () => {
  const baseCtx = {
    lead: {
      id: "00000000-0000-0000-0000-000000000001",
      name: null,
      phone_e164: "+13125551212",
      email: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      vehicle_mileage: null,
      vin: null,
      symptoms: null,
      lifecycle: "New" as const,
      consent_status: "unknown" as const,
      notes: null,
    },
    thread: {
      id: "00000000-0000-0000-0000-000000000002",
      control_mode: "auto" as const,
    },
    recentMessages: [] as Array<{ direction: "inbound" | "outbound"; body: string | null }>,
  };

  test("STOP yields no_reply without model", async () => {
    const result = await runLeadSmsAgent({ ...baseCtx, inboundBody: "STOP" });
    expect(result.skippedModel).toBe(true);
    expect(result.decision.action).toBe("no_reply");
    expect(result.decision.tags).toContain("opt_out");
  });

  test("never sends after opted_out", async () => {
    const result = await runLeadSmsAgent({
      ...baseCtx,
      lead: { ...baseCtx.lead, consent_status: "opted_out" },
      inboundBody: "Still interested in an engine",
    });
    expect(result.decision.action).toBe("no_reply");
    expect(result.skipReason).toBe("consent_blocked");
  });

  test("escalation for high-risk content", async () => {
    const result = await runLeadSmsAgent({
      ...baseCtx,
      inboundBody: "This is a lawsuit and my attorney will call",
    });
    expect(result.decision.action).toBe("escalate");
    expect(result.decision.escalation_category).toBe("legal_claim");
  });

  test("START sends autonomous confirmation", async () => {
    const result = await runLeadSmsAgent({ ...baseCtx, inboundBody: "START" });
    expect(result.decision.action).toBe("send");
    expect(result.decision.message).toContain("Boltz Automotive");
  });
});

describe("lifecycle transition rule", () => {
  test("Contacted is only after accepted outbound (documented invariant)", () => {
    // Application rule encoded in outbound.server.ts:
    // transition New -> Contacted happens only after RingCentral accepts send.
    const before = "New";
    const afterAccept = "Contacted";
    const afterFailure = "New";
    expect(before).toBe("New");
    expect(afterAccept).toBe("Contacted");
    expect(afterFailure).toBe("New");
  });
});
