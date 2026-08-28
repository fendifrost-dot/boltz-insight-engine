export class JobLeaseLostError extends Error {
  constructor(message = "Job lease lost before worker could finish") {
    super(message);
    this.name = "JobLeaseLostError";
  }
}

export type JobLeaseRpcStatus = "completed" | "lost_lease" | "pending" | "dead";

export function assertJobLeaseRpcStatus(
  data: unknown,
  allowed: JobLeaseRpcStatus[],
): JobLeaseRpcStatus {
  const status = (data as { status?: string } | null)?.status;
  if (!status || !allowed.includes(status as JobLeaseRpcStatus)) {
    throw new Error(`Unexpected job lease RPC status: ${String(status)}`);
  }
  return status as JobLeaseRpcStatus;
}
