// Pure job-lease and inbound auto-reply rules. No database and no secrets.
import { detectOptIn, detectOptOut } from "./safety.server.ts";

/** How long a processing row may stay locked before another worker may reclaim it. */
export const JOB_LEASE_MS = 120_000;

/**
 * Wall-clock budget for one processJobs invocation. Short enough that the
 * serverless isolate can record success or failure before the platform kills it.
 */
export const PROCESS_BUDGET_MS = 20_000;

/** Model calls are aborted so a hung xAI request becomes a retryable failure. */
export const XAI_DECISION_TIMEOUT_MS = 15_000;

/** Inbound SMS older than this does not get an automated text. */
export const INBOUND_AUTO_REPLY_WINDOW_MS = 15 * 60 * 1000;

/** Local bookkeeping (store, opt-out, escalation) needs only a short reserve. */
export const LOCAL_JOB_RESERVE_MS = 2_000;

/** A model call or a live send needs the timeout plus a moment to record the outcome. */
export const CALL_OUT_RESERVE_MS = XAI_DECISION_TIMEOUT_MS + 4_000;

export const LEASE_EXPIRED_LAST_ERROR =
  "Previous attempt ended without finishing (processing lease expired)";

export const LEASE_EXHAUSTED_LAST_ERROR =
  "Processing lease expired after the maximum number of attempts";

export const ATTEMPTS_EXHAUSTED_LAST_ERROR = "Job reached the maximum number of attempts";

export const STALE_INBOUND_REASON =
  "Inbound SMS is outside the auto-reply window. It was stored for a person and no automated text was sent.";

export const STALE_OPT_OUT_REASON =
  "Opt-out was recorded outside the auto-reply window. No confirmation text was sent.";

export const OPT_OUT_NOT_APPLIED_REASON =
  "An older opt-out was not applied because a newer consent change is already recorded.";

export type ClaimDecision =
  | { action: "claim_pending" }
  | { action: "claim_stale" }
  | { action: "expire"; reason: string }
  | { action: "skip" };

export type JobClaimInput = {
  status: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  run_after: string;
};

export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function decideClaim(job: JobClaimInput, now: Date, leaseMs = JOB_LEASE_MS): ClaimDecision {
  if (job.status === "pending") {
    const runAfter = parseTime(job.run_after);
    if (runAfter != null && runAfter > now.getTime()) return { action: "skip" };
    if (job.attempts >= job.max_attempts) {
      return { action: "expire", reason: ATTEMPTS_EXHAUSTED_LAST_ERROR };
    }
    return { action: "claim_pending" };
  }

  if (job.status === "processing") {
    if (!processingLeaseExpired(job.locked_at, now, leaseMs)) return { action: "skip" };
    if (job.attempts >= job.max_attempts) {
      return { action: "expire", reason: LEASE_EXHAUSTED_LAST_ERROR };
    }
    return { action: "claim_stale" };
  }

  return { action: "skip" };
}

/** A processing row with no lock, or a lock older than the lease, is reclaimable. */
export function processingLeaseExpired(
  lockedAt: string | null,
  now: Date,
  leaseMs = JOB_LEASE_MS,
): boolean {
  const locked = parseTime(lockedAt);
  if (locked == null) return true;
  return now.getTime() - locked >= leaseMs;
}

/**
 * A permanent failure is dead on the attempt that hit it. Retrying will not
 * make an unstorable phone, or any other permanent input error, succeed.
 */
export class PermanentJobError extends Error {
  readonly permanent = true as const;
  readonly disposition = "needs_review" as const;

  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export function failureUpdate(
  job: { attempts: number; max_attempts: number },
  options?: { permanent: boolean },
): {
  status: "pending" | "dead";
  backoffMs: number;
  terminal: boolean;
} {
  const terminal = options?.permanent === true || job.attempts >= job.max_attempts;
  const backoffMs = Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, job.attempts - 1));
  return { status: terminal ? "dead" : "pending", backoffMs, terminal };
}

/** Failure text safe to store. Never stringifies an object into "[object Object]". */
export function errorText(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim().slice(0, 600);
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 600);
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 600);
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return `Job failed (${code.trim()})`.slice(0, 600);
  }
  return "Job failed";
}

export function describeXaiError(error: unknown): Error {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new Error("xAI request timed out");
  }
  if (error instanceof Error && error.message.trim()) return error;
  return new Error(errorText(error));
}

export function inboundReceivedAt(
  providerCreatedAt: string | null | undefined,
  jobCreatedAt: string,
): number | null {
  return parseTime(providerCreatedAt) ?? parseTime(jobCreatedAt);
}

/** True when an automated reply is still allowed. Missing timestamps are not allowed. */
export function inboundAutoReplyAllowed(args: {
  providerCreatedAt: string | null;
  jobCreatedAt: string;
  now: Date;
  windowMs?: number;
}): boolean {
  const received = inboundReceivedAt(args.providerCreatedAt, args.jobCreatedAt);
  if (received == null) return false;
  const age = args.now.getTime() - received;
  if (age < 0) return true;
  const windowMs = args.windowMs ?? INBOUND_AUTO_REPLY_WINDOW_MS;
  return age <= windowMs;
}

export type InboundHandlingPlan = {
  autoReply: boolean;
  applyOptOut: boolean;
  sendOptOutConfirmation: boolean;
  applyOptIn: boolean;
  surfaceForHuman: boolean;
};

/**
 * What processInbound may do. Stale inbound is stored and opted out by the
 * caller, and this plan refuses every automated text.
 */
export function planInboundHandling(args: {
  body: string;
  providerCreatedAt: string | null;
  jobCreatedAt: string;
  now: Date;
  consentStatus: string;
  windowMs?: number;
}): InboundHandlingPlan {
  const fresh = inboundAutoReplyAllowed(args);
  const optOut = detectOptOut(args.body);
  const optIn = detectOptIn(args.body);

  if (optOut) {
    return {
      autoReply: false,
      applyOptOut: true,
      sendOptOutConfirmation: fresh,
      applyOptIn: false,
      surfaceForHuman: !fresh,
    };
  }

  if (!fresh) {
    return {
      autoReply: false,
      applyOptOut: false,
      sendOptOutConfirmation: false,
      applyOptIn: false,
      surfaceForHuman: true,
    };
  }

  const blockedByOptOut = args.consentStatus === "opted_out" && !optIn;
  return {
    autoReply: !blockedByOptOut,
    applyOptOut: false,
    sendOptOutConfirmation: false,
    applyOptIn: optIn,
    surfaceForHuman: false,
  };
}

/**
 * Write opted_out only when this STOP is not already recorded and does not
 * overwrite a newer consent change (a later START must keep them opted in).
 */
export function shouldWriteOptOut(args: {
  consentStatus: string;
  consentUpdatedAt: string | null;
  inboundAtMs: number | null;
}): boolean {
  if (args.consentStatus === "opted_out") return false;
  const consent = parseTime(args.consentUpdatedAt);
  if (args.inboundAtMs != null && consent != null && consent > args.inboundAtMs) return false;
  return true;
}

type InboundJobShape = {
  job_type: string;
  created_at: string;
  payload?: unknown;
};

function inboundFields(payload: unknown): { body: string; providerCreatedAt: string | null } {
  if (!payload || typeof payload !== "object") return { body: "", providerCreatedAt: null };
  const record = payload as { body?: unknown; provider_created_at?: unknown };
  return {
    body: typeof record.body === "string" ? record.body : "",
    providerCreatedAt:
      typeof record.provider_created_at === "string" ? record.provider_created_at : null,
  };
}

/** True when running the job may call xAI or RingCentral. */
export function inboundMayCallOut(job: InboundJobShape, now: Date): boolean {
  if (job.job_type !== "process_inbound") return true;
  const fields = inboundFields(job.payload);
  const plan = planInboundHandling({
    body: fields.body,
    providerCreatedAt: fields.providerCreatedAt,
    jobCreatedAt: job.created_at,
    now,
    consentStatus: "unknown",
  });
  return plan.autoReply || plan.sendOptOutConfirmation;
}

export function reserveForJob(job: InboundJobShape, now: Date): number {
  return inboundMayCallOut(job, now) ? CALL_OUT_RESERVE_MS : LOCAL_JOB_RESERVE_MS;
}

export function replyTextFromAgentRaw(raw: unknown): string | null {
  let content: unknown = raw;
  if (raw && typeof raw === "object" && "content" in raw) {
    content = (raw as { content: unknown }).content;
  }
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content) as { action?: unknown; reply_text?: unknown };
    if (parsed.action !== "send" || typeof parsed.reply_text !== "string") return null;
    const text = parsed.reply_text.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export type DrainJob = JobClaimInput & {
  id: string;
  job_type: string;
  created_at: string;
  payload?: unknown;
};

export type DrainPlan = {
  reclaim: string[];
  expire: string[];
  skip: string[];
  suppressAutoReply: string[];
};

/** Read-only classification of rows a drain would reclaim. Does not send or write. */
export function planStaleDrain(jobs: DrainJob[], now: Date, leaseMs = JOB_LEASE_MS): DrainPlan {
  const plan: DrainPlan = { reclaim: [], expire: [], skip: [], suppressAutoReply: [] };
  for (const job of jobs) {
    const decision = decideClaim(job, now, leaseMs);
    if (decision.action === "claim_stale") {
      plan.reclaim.push(job.id);
      if (!inboundMayCallOut(job, now)) plan.suppressAutoReply.push(job.id);
    } else if (decision.action === "expire") {
      plan.expire.push(job.id);
    } else {
      plan.skip.push(job.id);
    }
  }
  return plan;
}
