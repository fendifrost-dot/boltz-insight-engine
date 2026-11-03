import test from "node:test";
import assert from "node:assert/strict";
import { parseInboundEmail } from "./parse-email.ts";
import { parseMetaLeadEmail } from "./parse-meta-email.ts";
import { normalizeFieldData } from "../meta-leads/normalize.ts";

const MESSAGE = "meta-msg-1";

test("a notice that names the shop inbox is still not a lead", () => {
  const parsed = parseMetaLeadEmail({
    from: "Facebook <notification@facebookmail.com>",
    subject: "You have a new lead",
    messageId: "notice-shop",
    body: "You have a new lead.\n\nView lead\n\nEmail: info@boltzautoinc.com\n",
  });
  assert.equal(parsed.kind, "notice");
});

test("a notice-only Meta lead email does not carry field details", () => {
  const parsed = parseMetaLeadEmail({
    from: "Facebook <notification@facebookmail.com>",
    subject: "You have a new lead",
    messageId: MESSAGE,
    body: `You have a new lead.

View lead
https://business.facebook.com/latest/leads_center
`,
  });
  assert.equal(parsed.kind, "notice");
});

test("inline Meta lead details map into the Meta lead model and keep the lead id", () => {
  const parsed = parseMetaLeadEmail({
    from: "Meta <noreply@metamail.com>",
    subject: "You have a new lead",
    messageId: MESSAGE,
    body: `You have a new lead

Lead ID: 2283654155812202
Full name: Dana Lee
Email: dana@example.com
Phone number: (312) 555-0101
Form: Estimate

Question: What does the car need?
Answer: Brake noise
`,
  });
  assert.equal(parsed.kind, "leads");
  if (parsed.kind !== "leads") return;
  assert.equal(parsed.leads.length, 1);
  const lead = parsed.leads[0]!;
  assert.equal(lead.metaLeadId, "2283654155812202");
  assert.equal(lead.syntheticId, false);
  assert.equal(lead.formName, "Estimate");
  const fields = normalizeFieldData(lead.fieldData);
  assert.equal(fields.name, "Dana Lee");
  assert.equal(fields.email, "dana@example.com");
  assert.equal(fields.phone_e164, "+13125550101");
  assert.match(fields.symptoms ?? "", /Brake noise/);
});

test("the same lead id in a later email is the same dedupe key", () => {
  const first = parseMetaLeadEmail({
    from: "notification@facebookmail.com",
    subject: "New lead",
    messageId: "one",
    body: "Lead ID: 2283654155812202\nEmail: dana@example.com\nPhone: 3125550101\n",
  });
  const second = parseMetaLeadEmail({
    from: "notification@facebookmail.com",
    subject: "New lead",
    messageId: "two",
    body: "Lead ID: l:2283654155812202\nEmail: dana@example.com\n",
  });
  assert.equal(first.kind, "leads");
  assert.equal(second.kind, "leads");
  if (first.kind !== "leads" || second.kind !== "leads") return;
  assert.equal(first.leads[0]?.metaLeadId, second.leads[0]?.metaLeadId);
});

test("a CSV attachment is lead details and a missing id is stable per message", () => {
  const csv = `id,created_time,form_name,platform,full_name,email,phone_number
2283654155812202,2026-11-03T18:04:00+0000,Estimate,fb,Dana Lee,dana@example.com,+13125550101
,2026-11-03T18:05:00+0000,Estimate,ig,Riley Quinn,riley@example.com,3125550199
`;
  const parsed = parseMetaLeadEmail({
    from: "Facebook <notification@facebookmail.com>",
    subject: "Your new leads",
    messageId: MESSAGE,
    body: "Your leads are attached.",
    csvText: csv,
  });
  assert.equal(parsed.kind, "leads");
  if (parsed.kind !== "leads") return;
  assert.equal(parsed.leads[0]?.metaLeadId, "2283654155812202");
  assert.equal(parsed.leads[0]?.syntheticId, false);
  assert.equal(parsed.leads[1]?.metaLeadId, `email:${MESSAGE}:1`);
  assert.equal(normalizeFieldData(parsed.leads[0]!.fieldData).name, "Dana Lee");
  assert.equal(normalizeFieldData(parsed.leads[1]!.fieldData).email, "riley@example.com");
  const replay = parseMetaLeadEmail({
    from: "notification@facebookmail.com",
    subject: "Your new leads",
    messageId: MESSAGE,
    body: "Your leads are attached.",
    csvText: csv,
  });
  assert.equal(replay.kind, "leads");
  if (replay.kind !== "leads") return;
  assert.equal(replay.leads[1]?.metaLeadId, parsed.leads[1]?.metaLeadId);
});

test("facebookmail phishing and Google lead mail are not Meta lead emails", () => {
  assert.equal(
    parseMetaLeadEmail({
      from: "Facebook <notification@facebookmail.com>",
      subject: "Action required: You're invited to join the Agency Partner Program",
      messageId: "phish",
      body: "Meta Agency invited you to join the Agency Partner Program.",
    }).kind,
    "ignore",
  );
  const google = {
    from: "Google Ads <ads-noreply@google.com>",
    subject: "You have a new lead",
    messageId: "gads-1",
    body: "Name: Alex Example\nEmail: alex@example.com\nPhone: (312) 555-0100\n",
  };
  assert.equal(parseMetaLeadEmail(google).kind, "ignore");
  const parsed = parseInboundEmail({ ...google, receivedAt: null });
  assert.equal(parsed?.source, "Google Ads");
  assert.equal(parsed?.email, "alex@example.com");
});
