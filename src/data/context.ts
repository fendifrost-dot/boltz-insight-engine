import type { ClaimClass } from "./types";

export interface ContextFact {
  label: string;
  value: string;
  claim: ClaimClass;
}

export const BUSINESS = {
  name: "Boltz Automotive Inc.",
  address: "707 W. 119th St., Chicago, IL 60628",
  phone: "(708) 575-4555",
  website: "https://boltzautogarage.com",
  hours: "Monday–Saturday, 9 AM–5 PM",
  lastAppointment: "Approximately 4 PM (typical last regular appointment)",
};

export const NAP_FACTS: ContextFact[] = [
  { label: "Business name", value: BUSINESS.name, claim: "OWNER-CONFIRMED" },
  { label: "Address", value: BUSINESS.address, claim: "OWNER-CONFIRMED" },
  { label: "Phone", value: BUSINESS.phone, claim: "OWNER-CONFIRMED" },
  { label: "Website", value: BUSINESS.website, claim: "OWNER-CONFIRMED" },
  { label: "Hours", value: BUSINESS.hours, claim: "OWNER-CONFIRMED" },
  { label: "Last appointment", value: BUSINESS.lastAppointment, claim: "OWNER-CONFIRMED" },
];

export const IDENTITY: ContextFact[] = [
  {
    label: "Full-service automotive repair",
    value: "Core identity. Mechanical repair is the core service line.",
    claim: "OWNER-CONFIRMED",
  },
  {
    label: "Mechanical repair shop",
    value: "Core service line.",
    claim: "OWNER-CONFIRMED",
  },
  {
    label: "Engine replacement provider",
    value: "Preferred, high-value service. Commercial growth priority #1.",
    claim: "OWNER-CONFIRMED",
  },
  {
    label: "Collision / body repair",
    value: "Substantial service line.",
    claim: "OWNER-CONFIRMED",
  },
  {
    label: "Paint / body department",
    value: "Substantial service line.",
    claim: "OWNER-CONFIRMED",
  },
];

export const HISTORY: ContextFact[] = [
  {
    label: "Legacy",
    value:
      "Boltz evolved from C&J Auto Rebuilders, a South Side automotive operation dating to approximately 1982 — more than 40 years of history. No additional history is to be invented.",
    claim: "OWNER-CONFIRMED",
  },
];

export const ARCHITECTURE: ContextFact[] = [
  {
    label: "Canonical public site",
    value: "boltzautogarage.com on Durable. Remains the public authority hub.",
    claim: "OWNER-CONFIRMED",
  },
  {
    label: "Transaction layer",
    value:
      "Separate Lovable-based payment/application experience (Stripe, Affirm, Klarna). Not merged with this Ops project.",
    claim: "OWNER-CONFIRMED",
  },
  {
    label: "This project",
    value:
      "Boltz SEO-GEO Ops — internal research, measurement, planning and experiment management. Not a public website.",
    claim: "OWNER-CONFIRMED",
  },
];

export const COMMERCIAL_PRIORITIES: ContextFact[] = [
  {
    label: "Priority 1",
    value:
      "Engine replacement growth. Do not build the system around reducing engine demand.",
    claim: "OWNER-CONFIRMED",
  },
  {
    label: "Capacity posture",
    value: "Boltz can expand mechanic capacity as demand grows.",
    claim: "OWNER-CONFIRMED",
  },
  {
    label: "Secondary lines",
    value: "Collision / body / paint remain substantial and should not be starved.",
    claim: "OWNER-CONFIRMED",
  },
];

export const FROZEN_CHANGES: string[] = [
  "Do not modify boltzautogarage.com",
  "Do not migrate Durable",
  "Do not alter DNS",
  "Do not change the Google Business Profile",
  "Do not publish pages",
  "Do not contact competitors or directories",
  "Do not solicit reviews or ask customers to use predetermined keywords",
  "Do not create backlinks, citations, reviews, or accounts",
  "Do not push any production change",
];

export const ACTIVE_EXPERIMENT_POSTURE = [
  "Boltz is already running controlled SEO/GEO experiments.",
  "Preserved baselines, pre/post intervention testing, intervention isolation.",
  "Every recommendation must flow: research → hypothesis → proposed intervention → approval → deployment → measurement.",
  "Never skip from competitor observation to production change.",
];

export const UNRESOLVED_QUESTIONS: string[] = [
  "Which retrieval sources actually feed AI direct mentions of Boltz?",
  "What is the current baseline engine-inquiry volume by channel?",
  "Which GBP category configuration is currently live (audit not yet entered)?",
  "Is Google Search Console access available for import?",
  "What share of engine inquiries convert to approved engine jobs?",
];

export const SPECULATIVE_CLAIMS: string[] = [
  "GBP posting frequency directly causes ranking improvement",
  "Keyword-rich owner review responses directly improve rankings",
  "Photo geotags materially improve rankings",
  "Competitor categories should be copied automatically",
  "Review velocity always outweighs total review count",
];
