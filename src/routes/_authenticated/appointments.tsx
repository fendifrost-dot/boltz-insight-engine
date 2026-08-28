import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { Tag, Td, Th, TableWrap } from "@/components/ops/Bits";
import {
  appointmentsShopTimezone,
  cancelAppointmentFn,
  createAppointmentFn,
  listAppointmentsFn,
  markAppointmentArrivedFn,
  markAppointmentNoShowFn,
} from "@/lib/appointments.functions";
import { listLeads } from "@/lib/lead-inbox.functions";
import {
  formatAppointmentInstant,
  formatShopLocalDayLabel,
  shopDayRangeIso,
  shopLocalToday,
  shopStartOfWeek,
  shopWeekRangeIso,
} from "@/lib/appointments-time.ts";

export const Route = createFileRoute("/_authenticated/appointments")({
  head: () => ({
    meta: [
      { title: "Appointments · Boltz Shop Manager" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => shopStartOfWeek(shopLocalToday()));
  const [view, setView] = useState<"week" | "day">("week");
  const [selectedDay, setSelectedDay] = useState(() => shopLocalToday());
  const [formError, setFormError] = useState<string | null>(null);
  const [lifecycleWarning, setLifecycleWarning] = useState<string | null>(null);
  const [form, setForm] = useState({
    leadId: "",
    date: shopLocalToday(),
    startTime: "09:00",
    endTime: "10:00",
    serviceSummary: "",
    overrideReason: "",
    capacityOverride: false,
  });

  const range = useMemo(() => {
    if (view === "day") {
      return shopDayRangeIso(selectedDay);
    }
    return shopWeekRangeIso(weekStart);
  }, [selectedDay, view, weekStart]);

  const listFn = useServerFn(listAppointmentsFn);
  const leadsFn = useServerFn(listLeads);
  const createFn = useServerFn(createAppointmentFn);
  const cancelFn = useServerFn(cancelAppointmentFn);
  const arrivedFn = useServerFn(markAppointmentArrivedFn);
  const noShowFn = useServerFn(markAppointmentNoShowFn);

  const appointments = useQuery({
    queryKey: ["appointments", range.fromIso, range.toIso],
    queryFn: () => listFn({ data: range }),
  });
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => leadsFn({}) });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["appointments"] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          leadId: form.leadId,
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          serviceSummary: form.serviceSummary,
          capacityOverride: form.capacityOverride,
          overrideReason: form.capacityOverride ? form.overrideReason : null,
          transitionLifecycle: true,
        },
      }),
    onSuccess: (result) => {
      setFormError(null);
      if (result.lifecycle && "rejected" in result.lifecycle && result.lifecycle.rejected) {
        setLifecycleWarning(
          `Appointment saved, but lead lifecycle did not update: ${result.lifecycle.rejected.reason}`,
        );
      } else {
        setLifecycleWarning(null);
      }
      setForm((current) => ({ ...current, serviceSummary: "", overrideReason: "", capacityOverride: false }));
      invalidate();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Could not create appointment"),
  });

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const [year, month, day] = weekStart.split("-").map(Number);
      const anchor = new Date(Date.UTC(year, month - 1, day));
      anchor.setUTCDate(anchor.getUTCDate() + index);
      return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(anchor.getUTCDate()).padStart(2, "0")}`;
    });
  }, [weekStart]);

  const shiftWeek = (deltaDays: number) => {
    const [year, month, day] = weekStart.split("-").map(Number);
    const anchor = new Date(Date.UTC(year, month - 1, day));
    anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
    setWeekStart(
      `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(anchor.getUTCDate()).padStart(2, "0")}`,
    );
  };

  return (
    <Shell>
      <PageHeader
        title="Appointments"
        subtitle={`Shop schedule (${appointmentsShopTimezone}). Times display in Chicago shop time.`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded px-3 py-2 text-sm ${view === "week" ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}
          onClick={() => setView("week")}
        >
          Week
        </button>
        <button
          type="button"
          className={`rounded px-3 py-2 text-sm ${view === "day" ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}
          onClick={() => setView("day")}
        >
          Day
        </button>
        {view === "week" ? (
          <>
            <button
              type="button"
              className="rounded bg-neutral-100 px-3 py-2 text-sm"
              onClick={() => shiftWeek(-7)}
            >
              Previous week
            </button>
            <button
              type="button"
              className="rounded bg-neutral-100 px-3 py-2 text-sm"
              onClick={() => setWeekStart(shopStartOfWeek(shopLocalToday()))}
            >
              This week
            </button>
            <button
              type="button"
              className="rounded bg-neutral-100 px-3 py-2 text-sm"
              onClick={() => shiftWeek(7)}
            >
              Next week
            </button>
          </>
        ) : (
          <input
            type="date"
            className="rounded border px-3 py-2 text-sm"
            value={selectedDay}
            onChange={(event) => setSelectedDay(event.target.value)}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title={view === "week" ? "Week list" : "Day list"}>
          {appointments.isLoading ? (
            <EmptyState title="Loading appointments…" />
          ) : (appointments.data ?? []).length === 0 ? (
            <EmptyState title="No appointments in this range" />
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Customer</Th>
                    <Th>Vehicle / concern</Th>
                    <Th>Status</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(appointments.data ?? []).map((appointment) => {
                    const lead = (leads.data ?? []).find((row) => row.id === appointment.lead_id);
                    return (
                      <tr key={appointment.id} className="border-t align-top">
                        <Td>
                          <div>{formatAppointmentInstant(appointment.starts_at, appointment.shop_timezone)}</div>
                          <div className="text-xs text-neutral-500">Source: {appointment.source}</div>
                        </Td>
                        <Td>
                          <div>{lead?.name ?? "Unknown lead"}</div>
                          <Link to="/leads" className="text-xs text-blue-700 underline">
                            Open lead inbox
                          </Link>
                        </Td>
                        <Td>
                          <div>
                            {[appointment.vehicle_year, appointment.vehicle_make, appointment.vehicle_model]
                              .filter(Boolean)
                              .join(" ") || "Vehicle not entered"}
                          </div>
                          <div className="text-xs text-neutral-600">{appointment.service_summary}</div>
                        </Td>
                        <Td>
                          <Tag tone={appointment.status === "cancelled" || appointment.status === "no_show" ? "warning" : "neutral"}>
                            {appointment.status}
                          </Tag>
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              className="rounded bg-neutral-100 px-2 py-1 text-left text-xs"
                              onClick={() =>
                                arrivedFn({ data: { appointmentId: appointment.id } }).then(invalidate)
                              }
                            >
                              Mark arrived
                            </button>
                            <button
                              type="button"
                              className="rounded bg-neutral-100 px-2 py-1 text-left text-xs"
                              onClick={() => {
                                const reason = window.prompt("Cancellation reason");
                                if (!reason?.trim()) return;
                                cancelFn({
                                  data: { appointmentId: appointment.id, reason: reason.trim() },
                                }).then(invalidate);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="rounded bg-neutral-100 px-2 py-1 text-left text-xs"
                              onClick={() => {
                                const reason = window.prompt("No-show reason");
                                if (!reason?.trim()) return;
                                noShowFn({
                                  data: { appointmentId: appointment.id, reason: reason.trim() },
                                }).then(invalidate);
                              }}
                            >
                              Mark no-show
                            </button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>

        <Panel title="Schedule appointment">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <label className="block text-sm">
              Lead
              <select
                className="mt-1 w-full rounded border px-3 py-2"
                value={form.leadId}
                onChange={(event) => setForm((current) => ({ ...current, leadId: event.target.value }))}
                required
              >
                <option value="">Select lead</option>
                {(leads.data ?? []).map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {(lead.name ?? "Unknown") + " · " + (lead.phone_e164 ?? "no phone")}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded border px-3 py-2"
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                required
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                Start
                <input
                  type="time"
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={form.startTime}
                  onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                  required
                />
              </label>
              <label className="block text-sm">
                End
                <input
                  type="time"
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={form.endTime}
                  onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
                  required
                />
              </label>
            </div>
            <label className="block text-sm">
              Service / concern
              <textarea
                className="mt-1 w-full rounded border px-3 py-2"
                rows={3}
                value={form.serviceSummary}
                onChange={(event) => setForm((current) => ({ ...current, serviceSummary: event.target.value }))}
                required
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.capacityOverride}
                onChange={(event) =>
                  setForm((current) => ({ ...current, capacityOverride: event.target.checked }))
                }
              />
              Owner capacity override
            </label>
            {form.capacityOverride ? (
              <label className="block text-sm">
                Override reason
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={form.overrideReason}
                  onChange={(event) => setForm((current) => ({ ...current, overrideReason: event.target.value }))}
                  required
                />
              </label>
            ) : null}
            {formError ? <p className="text-sm text-red-700">{formError}</p> : null}
            {lifecycleWarning ? <p className="text-sm text-amber-700">{lifecycleWarning}</p> : null}
            <button
              type="submit"
              className="w-full rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={create.isPending}
            >
              {create.isPending ? "Scheduling…" : "Create appointment"}
            </button>
          </form>
          {view === "week" ? (
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-neutral-600">
              {weekDays.map((day) => (
                <div key={day} className="rounded bg-neutral-50 p-2">
                  {formatShopLocalDayLabel(day)}
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
      </div>
    </Shell>
  );
}
