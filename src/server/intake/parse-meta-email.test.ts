import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { metaEmailDedupeId, parseMetaLeadEmail } from "./parse-meta-email.ts";
import { parseInboundEmail } from "./parse-email.ts";
import type { InboundEmail } from "./parse-email.ts";

const here = dirname(fileURLToPath(import.meta.url));
const LEAD_ID = "2283654155812202";
const PAGE_ID = "111222333444555";

function mail(
  partial: Partial<InboundEmail> & Pick<InboundEmail, "from" | "subject" | "body">,
): InboundEmail {
  return {
    messageId: "meta-msg-1",
    receivedAt: "2026-11-03T18:04:00.000Z",
    ...partial,
  };
}

const NOTICE = mail({
  from: "Facebook <notification@facebookmail.com>",
  subject: "You have a new lead",
  body: `Hi Boltz,

You have a new lead.

View Lead
https://www.facebook.com/ads/lead_gen/lead?leadgen_id=${LEAD_ID}&page_id=${PAGE_ID}

Thanks,
The Facebook Team
`,
});

const DETAILS = mail({
  from: "notification@facebookmail.com",
  subject: "You have a new lead",
  messageId: "meta-msg-2",
  body: `You have a new lead from your Facebook ad.

Lead ID: ${LEAD_ID}
Full name: Jane Doe
Email: jane@example.com
Phone number: (312) 555-0100
Form: Boltz estimate
Campaign: Winter brakes

What is wrong with the car?
Brakes grind
`,
});

test("a native Meta notice has no lead answers and keeps the lead id for dedupe", () => {
  const parsed = parseMetaLeadEmail(NOTICE);
  assert.ok(parsed);
  assert.equal(parsed.kind, "notice");
  assert.equal(parsed.metaLeadId, LEAD_ID);
  assert.equal(parsed.pageId, PAGE_ID);
  assert.equal(parsed.platform, "facebook");
  assert.deepEqual(parsed.fieldData, []);
  assert.equal(parseInboundEmail(NOTICE), null);
});

test("a Meta mail that includes answers becomes field_data and dedupes on the lead id", () => {
  const parsed = parseMetaLeadEmail(DETAILS);
  assert.ok(parsed);
  assert.equal(parsed.kind, "details");
  assert.equal(parsed.formName, "Boltz estimate");
  assert.equal(parsed.campaignName, "Winter brakes");
  const fields = new Map((parsed.fieldData ?? []).map((field) => [field.name, field.values?.[0]]));
  assert.equal(fields.get("full_name"), "Jane Doe");
  assert.equal(fields.get("email"), "jane@example.com");
  assert.equal(fields.get("phone_number"), "(312) 555-0100");
  assert.equal(fields.get("What is wrong with the car?"), "Brakes grind");
  assert.equal(metaEmailDedupeId(parsed, "meta-msg-2"), LEAD_ID);
  assert.equal(metaEmailDedupeId(parsed, "another-message"), LEAD_ID);

  const withoutId = parseMetaLeadEmail({
    ...DETAILS,
    body: DETAILS.body.replace(`Lead ID: ${LEAD_ID}`, "Reference: none"),
    messageId: "meta-msg-3",
  });
  assert.ok(withoutId);
  assert.equal(withoutId.kind, "details");
  assert.equal(withoutId.metaLeadId, null);
  assert.equal(metaEmailDedupeId(withoutId, "meta-msg-3"), "email:meta-msg-3");
  assert.notEqual(
    metaEmailDedupeId(withoutId, "meta-msg-4"),
    metaEmailDedupeId(withoutId, "meta-msg-3"),
  );
});

test("Yelp, Durable, Google, and Meta account mail are not Meta lead notices", () => {
  const yelp = mail({
    from: "reply+abc@messaging.yelp.com",
    subject: "New Message: Alex Example is requesting a quote",
    body: "Alex Example is interested in working with you",
  });
  const durable = mail({
    from: "notifications@email.durable.com",
    subject: "New website lead from Alex Example",
    body: "| Name | Alex Example |\n| Email | alex@example.com |\n",
  });
  const google = mail({
    from: "ads-noreply@google.com",
    subject: "You have a new lead",
    body: "Name: Alex Example\nEmail: alex@example.com\nPhone: 3125550199\n",
  });
  const security = mail({
    from: "notification@facebookmail.com",
    subject: "Confirm email for your Facebook authorization",
    body: "Confirm your email to finish signing in",
  });
  const approved = mail({
    from: "notification@facebookmail.com",
    subject: "Your ad was approved",
    body: "Boltz Automotive ads are running",
  });
  for (const email of [yelp, durable, google, security, approved]) {
    assert.equal(parseMetaLeadEmail(email), null);
  }
  const googleLead = parseInboundEmail(google);
  assert.ok(googleLead);
  assert.equal(googleLead.source, "Google Ads");
  const durableLead = parseInboundEmail(durable);
  assert.ok(durableLead);
  assert.equal(durableLead.source, "Durable website");
});

test("an Instagram subject on Meta mail is instagram, and the mailbox poll triggers reconcile for notices only", () => {
  const parsed = parseMetaLeadEmail(
    mail({
      from: "notification@facebookmail.com",
      subject: "You have a new lead on Instagram",
      body: "You have a new lead.\nView Lead\nhttps://www.facebook.com/latest/leads",
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.kind, "notice");
  assert.equal(parsed.platform, "instagram");
  assert.equal(parsed.metaLeadId, null);

  const ingest = readFileSync(join(here, "email-ingest.server.ts"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const metaAt = ingest.indexOf("parseMetaLeadEmail(");
  const otherAt = ingest.indexOf("parseInboundEmail(");
  assert.ok(metaAt >= 0 && otherAt > metaAt);
  const trigger = ingest.indexOf("triggerMetaLeadReconcileFromEmail()");
  const dry = ingest.indexOf('args.mode !== "dry-run" && summary.metaNotices > 0');
  assert.ok(dry >= 0 && trigger > dry);
});
