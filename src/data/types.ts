/**
 * Boltz SEO/GEO Ops — canonical data model.
 *
 * Core distinction enforced by these types:
 *   finding (Decision) -> hypothesis/proposed intervention -> approval
 *   -> Experiment (deployment) -> Measurement (outcome)
 *
 * A value that has never been measured is `null` and renders as "Not entered".
 * `0` means measured zero. The two are never conflated.
 */

export type Unknownable<T> = T | null;

export type ClaimClass =
  | "OWNER-CONFIRMED"
  | "CONFIRMED"
  | "OBSERVED"
  | "HYPOTHESIS"
  | "UNKNOWN";

export type Impact = "HIGH" | "MEDIUM" | "LOW";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type DeploymentState =
  | "RESEARCH ONLY"
  | "PREPARED"
  | "APPROVED"
  | "DEPLOYED"
  | "HELD"
  | "REJECTED";

export type DecisionStatus =
  | "RESEARCH NOW"
  | "PREPARE NOW"
  | "READY FOR REVIEW"
  | "APPROVED"
  | "DEPLOYED"
  | "HOLD FOR EXPERIMENT"
  | "REJECTED";

export type Platform =
  | "ChatGPT"
  | "Gemini"
  | "Perplexity"
  | "Copilot/Bing"
  | "Google AI"
  | "Grok";

export const PLATFORMS: Platform[] = [
  "ChatGPT",
  "Gemini",
  "Perplexity",
  "Copilot/Bing",
  "Google AI",
  "Grok",
];

export type QueryCluster =
  | "engine replacement"
  | "engine replacement cost"
  | "blown engine"
  | "repair vs replace engine"
  | "used/remanufactured/rebuilt engine"
  | "mechanic near me"
  | "auto repair Chicago"
  | "South Side auto repair"
  | "collision/body"
  | "financing/payment"
  | "trust/reputation";

export const QUERY_CLUSTERS: QueryCluster[] = [
  "engine replacement",
  "engine replacement cost",
  "blown engine",
  "repair vs replace engine",
  "used/remanufactured/rebuilt engine",
  "mechanic near me",
  "auto repair Chicago",
  "South Side auto repair",
  "collision/body",
  "financing/payment",
  "trust/reputation",
];

/** Commercial weighting per cluster. Engine clusters weigh highest. */
export const CLUSTER_WEIGHT: Record<QueryCluster, number> = {
  "engine replacement": 1.0,
  "engine replacement cost": 0.95,
  "blown engine": 0.9,
  "repair vs replace engine": 0.85,
  "used/remanufactured/rebuilt engine": 0.8,
  "mechanic near me": 0.55,
  "auto repair Chicago": 0.55,
  "South Side auto repair": 0.5,
  "collision/body": 0.45,
  "financing/payment": 0.4,
  "trust/reputation": 0.35,
};

export interface QueryRecord {
  id: string;
  query: string;
  cluster: QueryCluster;
  intent: "informational" | "commercial" | "transactional" | "navigational";
  commercialPriority: Impact;
  engineRelevance: Impact;
  platform: Platform | "Google" | "Google Maps";
  baselineVisibility: Unknownable<string>;
  currentVisibility: Unknownable<string>;
  notes?: string;
}

export interface AiVisibilityRecord {
  id: string;
  queryId: Unknownable<string>;
  query: string;
  platform: Platform;
  date: string;
  directMention: Unknownable<boolean>;
  recommendationRank: Unknownable<number>;
  presentInRetrievedSource: Unknownable<boolean>;
  sourceUrl: Unknownable<string>;
  sourceInternalRank: Unknownable<number>;
  boltzSiteCited: Unknownable<boolean>;
  competitors: string[];
  factualAccuracy: Unknownable<"accurate" | "partially accurate" | "inaccurate">;
  serviceAssociation: Unknownable<string>;
  engineAssociation: Unknownable<boolean>;
  notes?: string;
}

export interface Competitor {
  id: string;
  name: string;
  website: Unknownable<string>;
  gbp: Unknownable<string>;
  location: Unknownable<string>;
  primaryCategory: Unknownable<string>;
  secondaryCategories: string[];
  reviewCount: Unknownable<number>;
  reviewVelocity: Unknownable<string>;
  services: string[];
  enginePages: Unknownable<number>;
  engineCostPages: Unknownable<number>;
  financing: Unknownable<string>;
  warrantyLanguage: Unknownable<string>;
  backlinks: Unknownable<number>;
  citations: Unknownable<number>;
  aiVisibility: Unknownable<string>;
  retrievalSources: string[];
  claimClass: ClaimClass;
  notes: string;
  updatedAt: Unknownable<string>;
}

export type SourceType =
  | "directory"
  | "review"
  | "editorial"
  | "database"
  | "UGC"
  | "AI synthesis"
  | "first-party"
  | "social"
  | "other";

export interface ProvenanceRecord {
  id: string;
  url: string;
  domain: string;
  sourceType: SourceType;
  firstParty: Unknownable<boolean>;
  independent: Unknownable<boolean>;
  syndicated: Unknownable<boolean>;
  derivative: Unknownable<boolean>;
  originalSource: Unknownable<string>;
  businessControlled: Unknownable<boolean>;
  entitiesMentioned: string[];
  queriesSurfacedFor: string[];
  platformsSurfacedOn: Platform[];
  claimClass: ClaimClass;
  notes: string;
}

export interface DecisionRecord {
  id: string;
  finding: string;
  date: string;
  source: string;
  category: string;
  claimClass: ClaimClass;
  seoImpact: Impact;
  geoImpact: Impact;
  engineJobRelevance: Impact;
  commercialValue: Impact;
  confidence: Confidence;
  effort: Impact;
  timeToSignal: Unknownable<string>;
  contaminationRisk: Impact;
  reversible: Unknownable<boolean>;
  proposedAction: string;
  status: DecisionStatus;
  approved: Unknownable<boolean>;
  deploymentBatch: Unknownable<string>;
  deploymentDate: Unknownable<string>;
  measurementDate: Unknownable<string>;
  outcome: Unknownable<string>;
  deploymentState: DeploymentState;
}

export interface ExperimentRecord {
  id: string;
  hypothesis: string;
  baselineDate: Unknownable<string>;
  deploymentDate: Unknownable<string>;
  intervention: string;
  surfacesAffected: string[];
  controlVariables: string[];
  confounders: string[];
  holdList: string[];
  checkpointDates: string[];
  successCriteria: string;
  failureCriteria: string;
  status:
    | "BASELINE"
    | "PREPARED"
    | "RUNNING"
    | "MEASURING"
    | "CONCLUDED"
    | "ABANDONED";
  immutable: boolean;
  notes?: string;
}

export type MetricKind = "funnel" | "engagement" | "search" | "ai";

export interface MeasurementRecord {
  id: string;
  metric: string;
  kind: MetricKind;
  period: string;
  value: Unknownable<number>;
  unit: Unknownable<string>;
  source: Unknownable<string>;
  experimentId: Unknownable<string>;
}

export interface AuditModule {
  id: string;
  name: string;
  family: "Local SEO" | "Website SEO" | "GEO / AI" | "Authority";
  purpose: string;
  inputs: string[];
  outputs: string;
  lastRun: Unknownable<string>;
}

export interface DataSet {
  queries: QueryRecord[];
  aiVisibility: AiVisibilityRecord[];
  competitors: Competitor[];
  provenance: ProvenanceRecord[];
  decisions: DecisionRecord[];
  experiments: ExperimentRecord[];
  measurements: MeasurementRecord[];
  modules: AuditModule[];
}

const IMPACT_SCORE: Record<Impact, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const CONFIDENCE_SCORE: Record<Confidence, number> = { HIGH: 1, MEDIUM: 0.66, LOW: 0.33 };

/**
 * Opportunity Score =
 *   SEO/GEO opportunity x commercial intent x engine-job value x confidence / effort
 * Every factor stays visible in the UI — no black box.
 */
export function opportunityScore(d: DecisionRecord) {
  const seoGeo = (IMPACT_SCORE[d.seoImpact] + IMPACT_SCORE[d.geoImpact]) / 2;
  const commercial = IMPACT_SCORE[d.commercialValue];
  const engine = IMPACT_SCORE[d.engineJobRelevance];
  const confidence = CONFIDENCE_SCORE[d.confidence];
  const effort = IMPACT_SCORE[d.effort];
  const score = (seoGeo * commercial * engine * confidence) / effort;
  return {
    score: Math.round(score * 10) / 10,
    factors: { seoGeo, commercial, engine, confidence, effort },
  };
}
