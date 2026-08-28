import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { applyLifecycleTransition } from "@/server/lead-inbox/lifecycle.server";
import { addEvent } from "@/server/lead-inbox/store.server";
import {
  SchedulingAuthorizationError,
  type AppointmentRow,
  type AppointmentStatus,
} from "./scheduling.ts";
import { SHOP_TIMEZONE } from "@/lib/appointments-time.ts";

export type AppointmentLifecycleResult =
  | { applied: true }
  | { applied: false; unchanged?: true }
  | { applied: false; rejected: { reason: string; code: string } };

export type CreateAppointmentResult = {
  appointment: AppointmentRow;
  lifecycle?: AppointmentLifecycleResult;
};

type CreateAppointmentArgs = {
  leadId: string;
  startsAtIso: string;
  endsAtIso: string;
  shopTimezone?: string;
  vehicleYear?: number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleDescription?: string | null;
  serviceSummary: string;
  source?: string;
  externalReference?: string | null;
  actor: string;
  assertedBy: string;
  capacityOverride?: boolean;
  overrideReason?: string | null;
  transitionLifecycle?: boolean;
  fromLifecycle?: Database["public"]["Enums"]["lead_lifecycle"];
};

function mapRpcAppointment(payload: { appointment?: AppointmentRow } | null): AppointmentRow {
  const appointment = payload?.appointment;
  if (!appointment?.id) {
    throw new Error("Appointment RPC returned an invalid payload");
  }
  return appointment;
}

async function applyAppointmentLifecycle(args: {
  leadId: string;
  appointmentId: string;
  actor: string;
  assertedBy: string;
  fromLifecycle: Database["public"]["Enums"]["lead_lifecycle"];
  serviceSummary: string;
}): Promise<AppointmentLifecycleResult> {
  if (args.fromLifecycle === "Appointment Scheduled") {
    return { applied: false, unchanged: true };
  }

  const transition = await applyLifecycleTransition({
    leadId: args.leadId,
    fromLifecycle: args.fromLifecycle,
    toLifecycle: "Appointment Scheduled",
    actor: args.actor,
    evidence: {
      basis: "appointment_record",
      evidenceRef: args.appointmentId,
      assertedBy: args.assertedBy,
      note: args.serviceSummary.slice(0, 300),
    },
    summary: "Lifecycle moved to Appointment Scheduled from scheduling",
  });

  if (transition.ok && transition.applied) {
    return { applied: true };
  }

  if (transition.ok && !transition.applied) {
    return { applied: false, unchanged: true };
  }

  const rejected = {
    reason: transition.reason,
    code: transition.code,
  };

  await addEvent(
    args.leadId,
    "lifecycle_transition_rejected",
    transition.reason,
    args.actor,
    {
      proposed_to: "Appointment Scheduled",
      appointment_id: args.appointmentId,
      code: transition.code,
    },
  );

  return { applied: false, rejected };
}

export async function createAppointment(args: CreateAppointmentArgs): Promise<CreateAppointmentResult> {
  if (args.capacityOverride && !args.overrideReason?.trim()) {
    throw new SchedulingAuthorizationError("Capacity override requires an explicit reason");
  }

  const { data, error } = await supabaseAdmin.rpc("create_appointment_atomic", {
    _lead_id: args.leadId,
    _starts_at: args.startsAtIso,
    _ends_at: args.endsAtIso,
    _shop_timezone: args.shopTimezone ?? SHOP_TIMEZONE,
    _vehicle_year: args.vehicleYear ?? null,
    _vehicle_make: args.vehicleMake ?? null,
    _vehicle_model: args.vehicleModel ?? null,
    _vehicle_description: args.vehicleDescription ?? null,
    _service_summary: args.serviceSummary.slice(0, 2000),
    _source: args.source ?? "shop_manager",
    _external_reference: args.externalReference ?? null,
    _created_by: args.actor,
    _capacity_override: args.capacityOverride ?? false,
    _override_reason: args.overrideReason ?? null,
  });
  if (error) throw error;

  const appointment = mapRpcAppointment(data as { appointment?: AppointmentRow } | null);
  let lifecycle: AppointmentLifecycleResult | undefined;

  if (args.transitionLifecycle && args.fromLifecycle) {
    lifecycle = await applyAppointmentLifecycle({
      leadId: args.leadId,
      appointmentId: appointment.id,
      actor: args.actor,
      assertedBy: args.assertedBy,
      fromLifecycle: args.fromLifecycle,
      serviceSummary: args.serviceSummary,
    });
  }

  return { appointment, lifecycle };
}

export async function listAppointments(args: {
  fromIso: string;
  toIso: string;
  statuses?: AppointmentStatus[];
}): Promise<AppointmentRow[]> {
  let query = supabaseAdmin
    .from("appointments")
    .select("*")
    .gte("starts_at", args.fromIso)
    .lt("starts_at", args.toIso)
    .order("starts_at", { ascending: true });

  if (args.statuses?.length) {
    query = query.in("status", args.statuses);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function rescheduleAppointment(args: {
  appointmentId: string;
  startsAtIso: string;
  endsAtIso: string;
  actor: string;
  capacityOverride?: boolean;
  overrideReason?: string | null;
}): Promise<AppointmentRow> {
  if (args.capacityOverride && !args.overrideReason?.trim()) {
    throw new SchedulingAuthorizationError("Capacity override requires an explicit reason");
  }

  const { data, error } = await supabaseAdmin.rpc("reschedule_appointment_atomic", {
    _appointment_id: args.appointmentId,
    _starts_at: args.startsAtIso,
    _ends_at: args.endsAtIso,
    _updated_by: args.actor,
    _capacity_override: args.capacityOverride ?? false,
    _override_reason: args.overrideReason ?? null,
  });
  if (error) throw error;

  const payload = data as { status?: string; current_status?: string } | null;
  if (payload?.status === "not_found") {
    throw new Error("Appointment not found");
  }
  if (payload?.status === "invalid_status") {
    throw new Error("Cancelled or no-show appointments cannot be rescheduled");
  }

  return mapRpcAppointment(data as { appointment?: AppointmentRow } | null);
}

export async function cancelAppointment(args: {
  appointmentId: string;
  reason: string;
  actor: string;
}): Promise<AppointmentRow> {
  const { data, error } = await supabaseAdmin.rpc("cancel_appointment_atomic", {
    _appointment_id: args.appointmentId,
    _reason: args.reason.slice(0, 600),
    _updated_by: args.actor,
  });
  if (error) throw error;

  const payload = data as { status?: string } | null;
  if (payload?.status === "not_found") {
    throw new Error("Appointment not found");
  }

  return mapRpcAppointment(data as { appointment?: AppointmentRow } | null);
}

export async function markAppointmentArrived(args: {
  appointmentId: string;
  actor: string;
}): Promise<AppointmentRow> {
  const { data, error } = await supabaseAdmin.rpc("mark_appointment_arrived_atomic", {
    _appointment_id: args.appointmentId,
    _updated_by: args.actor,
  });
  if (error) throw error;

  const payload = data as { status?: string } | null;
  if (payload?.status === "not_found") {
    throw new Error("Appointment not found");
  }

  return mapRpcAppointment(data as { appointment?: AppointmentRow } | null);
}

export async function markAppointmentNoShow(args: {
  appointmentId: string;
  reason: string;
  actor: string;
}): Promise<AppointmentRow> {
  const { data, error } = await supabaseAdmin.rpc("mark_appointment_no_show_atomic", {
    _appointment_id: args.appointmentId,
    _reason: args.reason.slice(0, 600),
    _updated_by: args.actor,
  });
  if (error) throw error;

  const payload = data as { status?: string } | null;
  if (payload?.status === "not_found") {
    throw new Error("Appointment not found");
  }

  return mapRpcAppointment(data as { appointment?: AppointmentRow } | null);
}
