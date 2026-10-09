import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Footprints, Phone } from "lucide-react";
import { DeskShell } from "@/components/desk/DeskShell";
import { deskSourceLabel, deskStatusLabel } from "@/lib/desk-display";
import { useServerFn } from "@tanstack/react-start";
import { HeardAboutPicker } from "@/components/desk/HeardAboutPicker";
import { addDeskNote, createDeskLead } from "@/lib/desk.functions";
import { displayPhone } from "@/lib/lead-inbox-thread-sync";
import { type DeskChannel, type DeskHeardAbout } from "@/lib/desk-intake";

export const Route = createFileRoute("/_authenticated/desk/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    channel: search["channel"] === "phone" ? ("phone" as const) : ("walk_in" as const),
  }),
  head: () => ({
    meta: [{ title: "New lead · Shop desk" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: NewDeskLeadPage,
});

const fieldClass = "desk-field";

function NewDeskLeadPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
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
        setFollowUp(
          [
            `New ${channel === "phone" ? "phone call" : "walk-in"}.`,
            name && `Name: ${name}`,
            [year, make, model].filter(Boolean).join(" "),
            concern && `Needs: ${concern}`,
            appointment && "Would like a visit",
            notes,
          ]
            .filter(Boolean)
            .join("\n"),
        );
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
      await queryClient.invalidateQueries({ queryKey: ["desk-leads"] });
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
      await queryClient.invalidateQueries({ queryKey: ["desk-lead", duplicate.leadId] });
      await queryClient.invalidateQueries({ queryKey: ["desk-leads"] });
      setNoteSaved(true);
      setFollowUp("");
    } catch {
      setError("Could not save the note. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DeskShell>
      <Link to="/desk" className="desk-back">
        <ArrowLeft size={16} /> Front desk
      </Link>
      <header className="desk-page-heading">
        <div className="desk-eyebrow">LET’S GET THE DETAILS</div>
        <h1>{channel === "phone" ? "A good call starts here." : "Welcome to Boltz."}</h1>
        <p>
          {duplicate
            ? "We already know this customer. Keep everything in one place."
            : "A few details now. A better follow-up later."}
        </p>
      </header>
      {duplicate ? (
        <section className="desk-form-card">
          <div className="desk-success-icon">
            <Check size={26} />
          </div>
          <h2>We found their customer card.</h2>
          <p className="desk-muted">
            {duplicate.name || "Name not recorded"} · {displayPhone(phone)}
          </p>
          <p className="desk-note">
            {deskSourceLabel(duplicate.leadSource)} ·{" "}
            {deskStatusLabel(duplicate.lifecycle || "New")}
          </p>
          {duplicate.ads && (
            <p className="desk-note">Their recent Google call is already linked.</p>
          )}
          {!noteSaved ? (
            <>
              <label className="desk-label">
                Add today’s conversation
                <textarea
                  className="desk-field"
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  rows={5}
                  maxLength={2000}
                />
              </label>
              <p className="desk-note">
                We kept what you just entered here. Save it as a note on their existing card.
              </p>
              <button
                type="button"
                className="desk-button"
                disabled={busy || !followUp.trim()}
                onClick={() => void saveNote()}
              >
                {busy ? "Saving…" : "Save conversation"}
              </button>
            </>
          ) : (
            <p role="status" className="desk-success">
              Today’s conversation is saved.
            </p>
          )}
          <Link
            to="/desk/leads/$leadId"
            params={{ leadId: duplicate.leadId }}
            className="desk-button secondary"
          >
            Open customer card
          </Link>
          {error && (
            <p role="alert" className="desk-error">
              {error}
            </p>
          )}
        </section>
      ) : (
        <form onSubmit={onSubmit} className="desk-form-card">
          <div className="desk-channel-switch" aria-label="How they reached us">
            <button
              type="button"
              aria-pressed={channel === "walk_in"}
              onClick={() => setChannel("walk_in")}
            >
              <Footprints size={18} />
              Walk-in
            </button>
            <button
              type="button"
              aria-pressed={channel === "phone"}
              onClick={() => setChannel("phone")}
            >
              <Phone size={18} />
              Phone call
            </button>
          </div>
          <div className="desk-form-section">
            <div className="desk-form-step">
              <span>01</span>
              <h2>The customer</h2>
            </div>
            <div className="desk-field-row">
              <label className="desk-label">
                Customer name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  placeholder="First and last name"
                  maxLength={120}
                  className={fieldClass}
                />
              </label>
              <label className="desk-label">
                Phone number
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="(773) 555-0100"
                  maxLength={40}
                  className={fieldClass}
                />
              </label>
            </div>
            <p className="desk-note">
              A name or phone number is enough to start. Repeat numbers stay on one customer card.
            </p>
          </div>
          <div className="desk-form-section">
            <div className="desk-form-step">
              <span>02</span>
              <h2>What brings them in?</h2>
            </div>
            <div className="desk-vehicle-fields">
              <label className="desk-label">
                Year
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  inputMode="numeric"
                  placeholder="2018"
                  maxLength={4}
                  className={fieldClass}
                />
              </label>
              <label className="desk-label">
                Make
                <input
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="Toyota"
                  maxLength={40}
                  className={fieldClass}
                />
              </label>
              <label className="desk-label">
                Model
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Camry"
                  maxLength={40}
                  className={fieldClass}
                />
              </label>
            </div>
            <label className="desk-label">
              What does the vehicle need?
              <textarea
                value={concern}
                onChange={(e) => setConcern(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Brake noise, engine light, collision repair…"
                className={fieldClass}
              />
            </label>
          </div>
          <div className="desk-form-section">
            <div className="desk-form-step">
              <span>03</span>
              <h2>How did they find us?</h2>
            </div>
            <HeardAboutPicker value={heard} onChange={setHeard} />
            {heard === "other" && (
              <label className="desk-label">
                Their answer
                <input
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  placeholder="Where did they hear about Boltz?"
                  maxLength={80}
                  required
                  className={fieldClass}
                />
              </label>
            )}
            <label className="desk-checkbox">
              <input
                type="checkbox"
                checked={appointment}
                onChange={(e) => setAppointment(e.target.checked)}
              />
              They’d like to book a visit
            </label>
            <details className="desk-disclosure">
              <summary>
                Anything else to remember? <span>Optional notes</span>
              </summary>
              <label className="desk-label">
                Notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className={fieldClass}
                />
              </label>
            </details>
          </div>
          {error && (
            <p role="alert" className="desk-error">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="desk-button desk-save">
            {busy ? "Saving customer…" : "Save customer"}
            <Check size={19} />
          </button>
          <p className="desk-note desk-centered">
            You can add a confirmed visit on their customer card.
          </p>
        </form>
      )}
    </DeskShell>
  );
}
