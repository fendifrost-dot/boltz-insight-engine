import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  ClaimClass,
  Confidence,
  DecisionStatus,
  DeploymentState,
  Impact,
} from "@/data/types";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "unknown";

const TONE: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-border",
  primary: "bg-primary/15 text-primary border-primary/40",
  success: "bg-success/15 text-success border-success/40",
  warning: "bg-warning/15 text-warning border-warning/40",
  danger: "bg-destructive/15 text-destructive border-destructive/40",
  info: "bg-info/15 text-info border-info/40",
  unknown: "bg-muted text-muted-foreground border-border",
};

export function Tag({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const CLAIM_TONE: Record<ClaimClass, Tone> = {
  "OWNER-CONFIRMED": "success",
  CONFIRMED: "success",
  OBSERVED: "info",
  HYPOTHESIS: "warning",
  UNKNOWN: "unknown",
};

export const ClaimTag = ({ value }: { value: ClaimClass }) => (
  <Tag tone={CLAIM_TONE[value]}>{value}</Tag>
);

const LEVEL_TONE: Record<Impact, Tone> = {
  HIGH: "primary",
  MEDIUM: "info",
  LOW: "unknown",
};

export const LevelTag = ({ value, label }: { value: Impact | Confidence; label?: string }) => (
  <Tag tone={LEVEL_TONE[value as Impact]}>{label ? `${label} ${value}` : value}</Tag>
);

const STATUS_TONE: Record<DecisionStatus, Tone> = {
  "RESEARCH NOW": "info",
  "PREPARE NOW": "warning",
  "READY FOR REVIEW": "warning",
  APPROVED: "primary",
  DEPLOYED: "success",
  "HOLD FOR EXPERIMENT": "unknown",
  REJECTED: "danger",
};

export const StatusTag = ({ value }: { value: DecisionStatus }) => (
  <Tag tone={STATUS_TONE[value]}>{value}</Tag>
);

const DEPLOY_TONE: Record<DeploymentState, Tone> = {
  "RESEARCH ONLY": "info",
  PREPARED: "warning",
  APPROVED: "primary",
  DEPLOYED: "success",
  HELD: "unknown",
  REJECTED: "danger",
};

export const DeployTag = ({ value }: { value: DeploymentState }) => (
  <Tag tone={DEPLOY_TONE[value]}>{value}</Tag>
);

/**
 * Renders "Not entered" for null/undefined. A measured 0 renders as 0.
 * This distinction is load-bearing across the whole system.
 */
export function Value({
  value,
  suffix,
  className,
}: {
  value: string | number | boolean | null | undefined;
  suffix?: string;
  className?: string;
}) {
  if (value === null || value === undefined || value === "") {
    return <span className="font-mono text-xs text-unknown italic">Not entered</span>;
  }
  const text = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return (
    <span className={cn("text-sm text-foreground", className)}>
      {text}
      {suffix ? <span className="text-muted-foreground"> {suffix}</span> : null}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="panel px-4 py-3">
      <div className="label-caps">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "label-caps sticky top-0 border-b border-border bg-surface-2 px-3 py-2 font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-border/60 px-3 py-2 align-top", className)}>{children}</td>
  );
}
