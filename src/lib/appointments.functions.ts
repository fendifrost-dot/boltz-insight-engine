import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Constants } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability } from "@/server/authz/require-capability.server";
import {
  SchedulingAuthorizationError,
} from "@/server/appointments/scheduling.ts";
import { ShopLocalTimeError, shopLocalToUtcIso, SHOP_TIMEZONE } from "@/lib/appointments-time.ts";
import {
  cancelAppointment,
  createAppointment,
  listAppointments,
  markAppointmentArrived,
  markAppointmentNoShow,
  rescheduleAppointment,
} from "@/server/appointments/scheduling.server.ts";

const appointmentStatus = z.enum(Constants.public.Enums.appointment_status);

const vehicleFields = {
  vehicleYear: z.number().int().min(1900).max(2100).nullable().optional(),
  vehicleMake: z.string().max(100).nullable().optional(),
  vehicleModel: z.string().max(100).nullable().optional(),
  vehicleDescription: z.string().max(500).nullable().optional(),
};

function resolveActor(userId: string, usedOwnerOverride: boolean): string {
  return usedOwnerOverride ? `owner:${userId}` : `staff:${userId}`;
}

export const listAppointmentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromIso: z.string().datetime(),
        toIso: z.string().datetime(),
        statuses: z.array(appointmentStatus).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "appointments.manage");
    return listAppointments(data);
  });

export const createAppointmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        serviceSummary: z.string().min(1).max(2000),
        source: z.string().max(100).optional(),
        externalReference: z.string().max(200).nullable().optional(),
        transitionLifecycle: z.boolean().optional(),
        capacityOverride: z.boolean().optional(),
        overrideReason: z.string().max(600).nullable().optional(),
        ...vehicleFields,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "appointments.manage");
    const usedOwnerOverride = Boolean(data.capacityOverride);
    if (usedOwnerOverride) {
      await requireCapability(context, "appointments.override_capacity");
    }

    const { data: lead, error } = await context.supabase
      .from("leads")
      .select("id, lifecycle, vehicle_year, vehicle_make, vehicle_model")
      .eq("id", data.leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Lead not found");

    const actor = resolveActor(context.userId, usedOwnerOverride);

    try {
      const startsAtIso = shopLocalToUtcIso({ date: data.date, time: data.startTime });
      const endsAtIso = shopLocalToUtcIso({ date: data.date, time: data.endTime });

      return await createAppointment({
        leadId: data.leadId,
        startsAtIso,
        endsAtIso,
        vehicleYear: data.vehicleYear ?? lead.vehicle_year,
        vehicleMake: data.vehicleMake ?? lead.vehicle_make,
        vehicleModel: data.vehicleModel ?? lead.vehicle_model,
        vehicleDescription: data.vehicleDescription ?? null,
        serviceSummary: data.serviceSummary,
        source: data.source,
        externalReference: data.externalReference ?? null,
        actor,
        assertedBy: context.userId,
        capacityOverride: data.capacityOverride,
        overrideReason: data.overrideReason,
        transitionLifecycle: data.transitionLifecycle ?? true,
        fromLifecycle: lead.lifecycle,
      });
    } catch (err) {
      if (err instanceof ShopLocalTimeError || err instanceof SchedulingAuthorizationError) {
        throw new Error(err.message);
      }
      throw err;
    }
  });

export const rescheduleAppointmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        capacityOverride: z.boolean().optional(),
        overrideReason: z.string().max(600).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "appointments.manage");
    const usedOwnerOverride = Boolean(data.capacityOverride);
    if (usedOwnerOverride) {
      await requireCapability(context, "appointments.override_capacity");
    }
    const actor = resolveActor(context.userId, usedOwnerOverride);
    try {
      return await rescheduleAppointment({
        appointmentId: data.appointmentId,
        startsAtIso: shopLocalToUtcIso({ date: data.date, time: data.startTime }),
        endsAtIso: shopLocalToUtcIso({ date: data.date, time: data.endTime }),
        actor,
        capacityOverride: data.capacityOverride,
        overrideReason: data.overrideReason,
      });
    } catch (err) {
      if (err instanceof ShopLocalTimeError || err instanceof SchedulingAuthorizationError) {
        throw new Error(err.message);
      }
      throw err;
    }
  });

export const cancelAppointmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appointmentId: z.string().uuid(), reason: z.string().min(1).max(600) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "appointments.manage");
    const actor = resolveActor(context.userId, false);
    return cancelAppointment({ appointmentId: data.appointmentId, reason: data.reason, actor });
  });

export const markAppointmentArrivedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appointmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireCapability(context, "appointments.manage");
    const actor = resolveActor(context.userId, false);
    return markAppointmentArrived({ appointmentId: data.appointmentId, actor });
  });

export const markAppointmentNoShowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appointmentId: z.string().uuid(), reason: z.string().min(1).max(600) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "appointments.manage");
    const actor = resolveActor(context.userId, false);
    return markAppointmentNoShow({
      appointmentId: data.appointmentId,
      reason: data.reason,
      actor,
    });
  });

export const appointmentsShopTimezone = SHOP_TIMEZONE;
