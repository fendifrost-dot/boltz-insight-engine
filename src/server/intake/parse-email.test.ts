import test from "node:test";
import assert from "node:assert/strict";
import { parseInboundEmail, toValidE164 } from "./parse-email.ts";

const YELP_QUOTE = {
  from: "reply+abc123@messaging.yelp.com",
  subject: "New Message: Alex Example is requesting a quote from Boltz Automotive",
  messageId: "yelp-msg-1",
  receivedAt: "2026-09-27T15:00:00.000Z",
  body: `Alex Example is interested in working with you!

What type of auto repair service do you need?
Maintenance

What make is your vehicle?
Honda

What model and year is your vehicle?
2019 Honda Civic

How many miles does your vehicle have?
42000

Are there any other details you'd like to share?
The car shakes when braking

https://biz.yelp.com/messaging/LOCATION/thread/THREAD123?utm_source=request_a_quote_first_message
`,
};

test("a Yelp quote email becomes a Yelp lead without a phone", () => {
  const parsed = parseInboundEmail(YELP_QUOTE);
  assert.ok(parsed);
  assert.equal(parsed.source, "Yelp");
  assert.equal(parsed.externalId, "yelp:THREAD123");
  assert.equal(parsed.name, "Alex Example");
  assert.equal(parsed.vehicleMake, "Honda");
  assert.equal(parsed.vehicleYear, 2019);
  assert.equal(parsed.vehicleModel, "Civic");
  assert.equal(parsed.vehicleMileage, 42000);
  assert.match(parsed.symptoms ?? "", /shakes when braking/);
  assert.equal(parsed.phoneRaw, null);
  assert.equal(parsed.smsOptIn, false);
});

test("Yelp login mail and reply mail are not leads", () => {
  assert.equal(
    parseInboundEmail({
      ...YELP_QUOTE,
      from: "no-reply@yelp.com",
      subject: "Your Yelp login link is here!",
      body: "Click the button to confirm your email",
    }),
    null,
  );
  assert.equal(
    parseInboundEmail({
      ...YELP_QUOTE,
      subject: "New Reply Message from Alex Example",
    }),
    null,
  );
});

test("a Durable website email maps fields and does not treat the consent boilerplate as STOP", () => {
  const parsed = parseInboundEmail({
    from: "notifications@email.durable.com",
    subject: "New website lead from Alex Example",
    messageId: "durable-msg-1",
    receivedAt: "2026-09-27T15:00:00.000Z",
    body: `| Name | Alex Example |
| Email | alex@example.com |
| Phone | 3125550100[](3125550100) |
| Year, Make, Model | 2012 VW cc |
| SMS Consent | I agree to receive customer care SMS. Reply STOP to opt out or HELP for help. |
| Message | Need an engine replacement |
`,
  });
  assert.ok(parsed);
  assert.equal(parsed.source, "Durable website");
  assert.equal(parsed.externalId, "durable:durable-msg-1");
  assert.equal(parsed.email, "alex@example.com");
  assert.equal(toValidE164(parsed.phoneRaw), "+13125550100");
  assert.equal(parsed.vehicleYear, 2012);
  assert.equal(parsed.vehicleMake, "VW");
  assert.equal(parsed.vehicleModel, "cc");
  assert.equal(parsed.smsOptIn, true);
  assert.equal(parsed.customerOptOut, false);
  assert.equal(parsed.symptoms, "Need an engine replacement");
});

test("a Durable message that is only STOP is an opt-out", () => {
  const parsed = parseInboundEmail({
    from: "support@durable.team",
    subject: "New website lead from Alex Example",
    messageId: "durable-msg-2",
    receivedAt: null,
    body: "| Name | Alex Example |\n| Message | STOP |\n",
  });
  assert.ok(parsed);
  assert.equal(parsed.customerOptOut, true);
});

test("Google marketing and review mail are not leads", () => {
  assert.equal(
    parseInboundEmail({
      from: "ads-noreply@google.com",
      subject: "Take the next step to help optimize Leads-Search-1",
      messageId: "ads-1",
      receivedAt: null,
      body: "Here are personalized recommendations",
    }),
    null,
  );
  assert.equal(
    parseInboundEmail({
      from: "businessprofile-noreply@google.com",
      subject: "Alex left a review for Boltz Auto Inc.",
      messageId: "gbp-1",
      receivedAt: null,
      body: "Go to reviews",
    }),
    null,
  );
});

test("a Google Local Services lead email is kept when it has a phone", () => {
  const parsed = parseInboundEmail({
    from: "local-services-noreply@google.com",
    subject: "You have a new Local Services lead",
    messageId: "lsa-1",
    receivedAt: null,
    body: "Name: Alex Example\nPhone: (312) 555-0199\n",
  });
  assert.ok(parsed);
  assert.equal(parsed.source, "Google LSA");
  assert.equal(parsed.externalId, "lsa:lsa-1");
  assert.equal(toValidE164(parsed.phoneRaw), "+13125550199");
});

test("a Business Profile message is a lead and a message-less mail is not", () => {
  const parsed = parseInboundEmail({
    from: "businessprofile-noreply@google.com",
    subject: "Alex sent you a message",
    messageId: "gbp-2",
    receivedAt: null,
    body: "Name | Alex Example\nPhone | 3125550188\n",
  });
  assert.ok(parsed);
  assert.equal(parsed.source, "Google Business Profile");
  assert.equal(
    parseInboundEmail({
      from: "businessprofile-noreply@google.com",
      subject: "Alex sent you a message",
      messageId: "gbp-3",
      receivedAt: null,
      body: "Open the app to read it",
    }),
    null,
  );
});
