import type { Database } from "@/integrations/supabase/types";
export { SHOP_TIMEZONE, formatAppointmentInstant, shopLocalToUtcIso } from "@/lib/appointments-time.ts";

export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];
export type AppointmentRow = Database["public"]["Tables"]["appointments"]["Row"];

const ACTIVE_STATUSES: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "arrived",
  "in_service",
  "completed",
];

export function isActiveAppointmentStatus(status: AppointmentStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export class SchedulingConflictError extends Error {
  constructor(
    message: string,
    readonly conflictAppointmentId?: string,
  ) {
    super(message);
  }
}

export class SchedulingAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
  }
}
