import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { HeardAboutPicker } from "@/components/desk/HeardAboutPicker";
import { PageHeader, Panel, Shell } from "@/components/ops/Shell";
import { addDeskNote, createDeskLead } from "@/lib/desk.functions";
import { displayPhone } from "@/lib/lead-inbox-thread-sync";
import { HEARD_ABOUT_LABEL, type DeskChannel, type DeskHeardAbout } from "@/lib/desk-intake";

export const Route = createFileRoute("/_authenticated/desk/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    channel: search["channel"] === "phone" ? ("phone" as const) : ("walk_in" as const),
  }),
  head: () => ({
    meta: [{ title: "New lead · Shop desk" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: NewDeskLeadPage,
});

const fieldClass =
  "min-h-14 w-full rounded-md border border-border bg-input px-3 text-lg text-foreground";

function NewDeskLeadPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const createFn = useServerFn(createDeskLead);
  const noteFn = useServerFn(addDeskNote);
  const [channel, setChannel] = useState<DeskChannel>(search.channel);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [concern, setConcern] = useState("");
  const [heard, setHeard] = useState<DeskHeardAbout | null>(null);
  const [other, setOther] = useState("");
  const [appointment, setAppointment] = useState(false);
  const [notes, setNotes] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{
    leadId: string;
    status: "duplicate" | "existing";
    name: string | null;
    leadSource: string | null;
    lifecycle: string | null;
    ads: boolean;
  } | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNoteSaved(false);
    if (!heard) {
      setError("Choose how they heard about the shop.");
      return;
    }
    const vehicleYear = year.trim() ? Number(year) : null;
    if (year.trim() && !Number.isInteger(vehicleYear)) {
      setError("Enter a four-digit vehicle year.");
      return;
    }
    setBusy(true);
    try {
      const result = await createFn({
        data: {
          channel,
          name,
          phone,
          vehicleYear,
          vehicleMake: make,
          vehicleModel: model,
          concern,
          heardAbout: heard,
          heardAboutOther: other,
          appointmentInterest: appointment,
          notes,
          idempotencyKey,
        },
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      if (result.status === "duplicate" || result.status === "existing") {
        setDuplicate({
          leadId: result.leadId,
          status: result.status,
          name: result.name,
          leadSource: result.leadSource,
          lifecycle: result.lifecycle,
          ads: Boolean(result.googleAdsCall),
        });
        return;
      }
      await navigate({ to: "/desk/leads/$leadId", params: { leadId: result.leadId } });
    } catch {
      setError("Could not save the lead. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!duplicate) return;
    setBusy(true);
    setError(null);
    try {
      const result = await noteFn({ data: { leadId: duplicate.leadId, note: followUp } });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setNoteSaved(true);
      setFollowUp("");
    } catch {
      setError("Could not save the note. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        kicker="Counter"
        title={channel === "phone" ? "New phone lead" : "New walk-in"}
        description="Ask how they heard about the shop before you save."
        actions={
          <Link to="/desk" className="text-sm font-medium text-primary">
            Desk home
          </Link>
        }
      />
      <form onSubmit={onSubmit} className="mx-auto max-w-xl space-y-5">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={channel === "walk_in"}
            onClick={() => setChannel("walk_in")}
            className={
              channel === "walk_in"
                ? "min-h-14 rounded-md border-2 border-primary bg-primary text-base font-semibold text-primary-foreground"
                : "min-h-14 rounded-md border border-border bg-card text-base font-semibold"
            }
          >
            Walk-in
          </button>
          <button
            type="button"
            aria-pressed={channel === "phone"}
            onClick={() => setChannel("phone")}
            className={
              channel === "phone"
                ? "min-h-14 rounded-md border-2 border-primary bg-primary text-base font-semibold text-primary-foreground"
                : "min-h-14 rounded-md border border-border bg-card text-base font-semibold"
            }
          >
            Phone
          </button>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="312 555 0100"
            className={fieldClass}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Used later for Square matching and texts. A repeat number opens the existing lead.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Year</span>
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Make</span>
            <input value={make} onChange={(e) => setMake(e.target.value)} className={fieldClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Concern</span>
          <textarea
            value={concern}
            onChange={(e) => setConcern(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-input px-3 py-3 text-lg"
          />
        </label>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">How did you hear about us?</legend>
          <HeardAboutPicker value={heard} onChange={setHeard} />
          {heard === "other" && (
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Short answer"
              className={`${fieldClass} mt-2`}
            />
          )}
          {heard && (
            <p className="mt-2 text-xs text-muted-foreground">
              Saved as the shop&apos;s existing source for {HEARD_ABOUT_LABEL[heard]}.
            </p>
          )}
        </fieldset>

        <label className="flex min-h-14 items-center gap-3 rounded-md border border-border px-3 text-base">
          <input
            type="checkbox"
            checked={appointment}
            onChange={(e) => setAppointment(e.target.checked)}
            className="size-5"
          />
          Wants an appointment
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-input px-3 py-3 text-lg"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="min-h-16 w-full rounded-lg bg-primary text-lg font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save lead"}
        </button>
      </form>

      {duplicate && (
        <Panel title="Already a lead" className="mx-auto mt-6 max-w-xl">
          <p className="text-base">
            {duplicate.status === "duplicate"
              ? "This phone was logged in the last 12 hours. Add a note instead of a second card."
              : "This phone is already a lead. The shop keeps one card per number. Add a note."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {duplicate.name || "No name"} · {displayPhone(phone)} ·{" "}
            {duplicate.leadSource || "No source"} · {duplicate.lifecycle || "New"}
          </p>
          {duplicate.ads && (
            <p className="mt-2 text-sm">
              This number matches a recent Google Ads call. The lead is linked.
            </p>
          )}
          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium">Add a note</span>
            <textarea
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-input px-3 py-3 text-lg"
            />
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy || !followUp.trim()}
              onClick={() => void saveNote()}
              className="min-h-14 flex-1 rounded-md bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-60"
            >
              Add note
            </button>
            <Link
              to="/desk/leads/$leadId"
              params={{ leadId: duplicate.leadId }}
              className="flex min-h-14 flex-1 items-center justify-center rounded-md border border-border px-4 text-base font-semibold"
            >
              Open lead
            </Link>
          </div>
          {noteSaved && <p className="mt-2 text-sm">Note saved on the existing lead.</p>}
        </Panel>
      )}
    </Shell>
  );
}
