import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { HeardAboutPicker } from "@/components/desk/HeardAboutPicker";
import { DeskShell } from "@/components/desk/DeskShell";
import { ArrowLeft, CalendarDays, MessageCircle, Phone, CarFront } from "lucide-react";
import { saveShopAppointment } from "@/lib/desk-chat.functions";
import { appointmentLocal, appointmentLabel } from "@/lib/desk-schedule";
import { deskSourceLabel, deskStatusLabel } from "@/lib/desk-display";
import {
  addDeskNote,
  getDeskLead,
  linkDeskGoogleAdsCall,
  setDeskAttribution,
} from "@/lib/desk.functions";
import { transitionLeadLifecycle } from "@/lib/lead-inbox.functions";
import { displayPhone } from "@/lib/lead-inbox-thread-sync";
import { LIFECYCLE_VALUES, type Lifecycle } from "@/lib/lifecycle-transitions";
import {
  deskLifecycleChoices,
  deskTransitionEvidence,
  HEARD_ABOUT_LABEL,
  isDeskHeardAbout,
  type DeskHeardAbout,
} from "@/lib/desk-intake";

export const Route = createFileRoute("/_authenticated/desk/leads/$leadId")({
  head: () => ({
    meta: [{ title: "Lead · Shop desk" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: DeskLeadDetail,
});

function isLifecycle(value: string): value is Lifecycle {
  return (LIFECYCLE_VALUES as readonly string[]).includes(value);
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function DeskLeadDetail() {
  const { leadId } = Route.useParams();
  const queryClient = useQueryClient();
  const detailFn = useServerFn(getDeskLead);
  const noteFn = useServerFn(addDeskNote);
  const attributeFn = useServerFn(setDeskAttribution);
  const linkFn = useServerFn(linkDeskGoogleAdsCall);
  const transitionFn = useServerFn(transitionLeadLifecycle);
  const appointmentFn = useServerFn(saveShopAppointment);
  const [visitTime, setVisitTime] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [note, setNote] = useState("");
  const [heard, setHeard] = useState<DeskHeardAbout | null>(null);
  const [other, setOther] = useState("");
  const [confirmSource, setConfirmSource] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["desk-lead", leadId],
    queryFn: () => detailFn({ data: { leadId } }),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["desk-lead", leadId] });
    void queryClient.invalidateQueries({ queryKey: ["desk-leads"] });
    void queryClient.invalidateQueries({ queryKey: ["shop-schedule"] });
  }

  const saveNote = useMutation({
    mutationFn: () => noteFn({ data: { leadId, note } }),
    onSuccess: (result) => {
      if (!result.ok) {
        setMessage(result.reason);
        return;
      }
      setNote("");
      setMessage("Note saved.");
      refresh();
    },
    onError: () => setMessage("Could not save the note."),
  });

  const saveSource = useMutation({
    mutationFn: () => {
      if (!heard) throw new Error("Choose how they heard about the shop");
      return attributeFn({
        data: {
          leadId,
          heardAbout: heard,
          heardAboutOther: other,
          confirm: confirmSource,
        },
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setMessage(result.reason);
        return;
      }
      setMessage(`Saved: ${deskSourceLabel(result.leadSource)}.`);
      refresh();
    },
    onError: () => setMessage("Could not save the source."),
  });

  const linkCall = useMutation({
    mutationFn: () => linkFn({ data: { leadId } }),
    onSuccess: (result) => {
      if (!result.ok) {
        setMessage(result.reason);
        return;
      }
      setMessage("Google Ads call linked.");
      refresh();
    },
    onError: () => setMessage("Could not link the call."),
  });

  const moveStatus = useMutation({
    mutationFn: (to: Lifecycle) => {
      const evidence = deskTransitionEvidence(to);
      return transitionFn({
        data: {
          leadId,
          toLifecycle: to,
          evidence: evidence.evidenceRef
            ? { basis: evidence.basis, evidenceRef: evidence.evidenceRef }
            : { basis: evidence.basis },
        },
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setMessage(result.reason);
        return;
      }
      setMessage(result.applied ? "Status updated." : "Status was already current.");
      refresh();
    },
    onError: () => setMessage("Could not update the status."),
  });

  const saveVisit = useMutation({
    mutationFn: (cancel: boolean) =>
      appointmentFn({
        data: {
          leadId,
          localTime: cancel ? null : visitTime,
          expectedAppointmentAt: detail.data?.lead.appointmentAt ?? null,
        },
      }),
    onSuccess: (result) => {
      setMessage(result.ok ? "Visit updated." : result.reason || "Could not save the visit.");
      if (result.ok) refresh();
    },
    onError: () => setMessage("Could not save the visit. Please try again."),
  });
  useEffect(() => {
    setVisitTime(appointmentLocal(detail.data?.lead.appointmentAt ?? null));
  }, [detail.data?.lead.appointmentAt]);
  const lead = detail.data?.lead;
  const lifecycle = lead && isLifecycle(lead.lifecycle) ? lead.lifecycle : null;
  const choices = lifecycle ? deskLifecycleChoices(lifecycle) : [];
  const sourceMissing = lead ? !lead.leadSource : false;
  const vehicle = lead
    ? [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ")
    : "";

  return (
    <DeskShell>
      <Link to="/desk/leads" className="desk-back">
        <ArrowLeft size={16} /> Find a customer
      </Link>
      {detail.isError ? (
        <div className="desk-empty">
          Could not load this customer.{" "}
          <button onClick={() => void detail.refetch()}>Try again</button>
        </div>
      ) : !lead ? (
        <div className="desk-empty">
          {detail.isPending ? "Opening customer card…" : "Customer not found."}
        </div>
      ) : (
        <>
          <header className="desk-page-heading">
            <div className="desk-eyebrow">CUSTOMER CARD</div>
            <h1>{lead.name || "Name not recorded"}</h1>
            <p className="desk-customer-subtitle">
              <Phone size={16} />
              {displayPhone(lead.phone)}
              {vehicle && (
                <>
                  <CarFront size={18} />
                  {vehicle}
                </>
              )}
            </p>
            <span className="desk-status-pill">{deskStatusLabel(lead.lifecycle)}</span>
          </header>
          {message && (
            <p role="status" className="desk-feedback">
              {message}
            </p>
          )}
          <section className="desk-form-card">
            <div className="desk-section-heading">
              <h2>What they need</h2>
              <Link to="/desk/chat" search={{ leadId }}>
                <MessageCircle size={16} /> Ask Grok
              </Link>
            </div>
            <p className="desk-concern">{lead.concern || "No repair details recorded yet."}</p>
            <div className="desk-inline-status">
              <label className="desk-label">
                Update progress
                <select
                  className="desk-field"
                  value={nextStatus}
                  onChange={(event) => setNextStatus(event.target.value)}
                >
                  <option value="">Choose the next step</option>
                  {choices.map((choice) => (
                    <option
                      key={choice}
                      value={choice}
                      disabled={choice === "Appointment Scheduled" && !lead.appointmentAt}
                    >
                      {deskStatusLabel(choice)}
                      {choice === "Appointment Scheduled" && !lead.appointmentAt
                        ? " — add a visit date first"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="desk-button secondary"
                disabled={!nextStatus || moveStatus.isPending}
                onClick={() => {
                  if (isLifecycle(nextStatus)) {
                    moveStatus.mutate(nextStatus);
                    setNextStatus("");
                  }
                }}
              >
                Update
              </button>
            </div>
          </section>
          <section className="desk-form-card">
            <div className="desk-section-heading">
              <h2>
                <CalendarDays size={19} /> Next visit
              </h2>
              <span>Chicago time</span>
            </div>
            <p className="desk-muted">
              {lead.appointmentAt
                ? appointmentLabel(lead.appointmentAt)
                : lead.appointmentInterest
                  ? "They’d like a visit. Confirm a time with them, then add it here."
                  : "No visit booked. Add a time once it’s confirmed with the customer."}
            </p>
            <div className="desk-inline-status">
              <label className="desk-label">
                Confirmed date and time
                <input
                  type="datetime-local"
                  className="desk-field"
                  value={visitTime}
                  onChange={(event) => setVisitTime(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="desk-button"
                disabled={!visitTime || saveVisit.isPending}
                onClick={() => saveVisit.mutate(false)}
              >
                {saveVisit.isPending ? "Saving…" : "Save visit"}
              </button>
            </div>
            {lead.appointmentAt && (
              <button
                type="button"
                className="desk-text-button"
                disabled={saveVisit.isPending}
                onClick={() => saveVisit.mutate(true)}
              >
                Cancel this visit
              </button>
            )}
          </section>
          <section className="desk-form-card">
            <h2>Conversation notes</h2>
            {lead.notes && <p className="desk-saved-notes">{lead.notes}</p>}
            <label className="desk-label">
              Add a note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you discuss? What’s the next step?"
                rows={3}
                maxLength={2000}
                className="desk-field"
              />
            </label>
            <button
              type="button"
              className="desk-button"
              disabled={saveNote.isPending || !note.trim()}
              onClick={() => saveNote.mutate()}
            >
              {saveNote.isPending ? "Saving…" : "Save note"}
            </button>
          </section>
          <details className="desk-form-card desk-details">
            <summary>
              How they found us <span>{deskSourceLabel(lead.leadSource)}</span>
            </summary>
            <p className="desk-note">
              {lead.intakePath === "desk"
                ? lead.intakeChannel === "phone"
                  ? "Called the shop"
                  : "Walked into the shop"
                : "Reached us online or by text"}
              {lead.heardAbout && isDeskHeardAbout(lead.heardAbout)
                ? ` · They said: ${HEARD_ABOUT_LABEL[lead.heardAbout]}`
                : ""}
            </p>
            <label className="desk-label">
              Correct their answer
              <HeardAboutPicker value={heard} onChange={setHeard} />
            </label>
            {heard === "other" && (
              <label className="desk-label">
                Where did they hear about us?
                <input
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  maxLength={80}
                  className="desk-field"
                />
              </label>
            )}
            {!sourceMissing && (
              <label className="desk-checkbox">
                <input
                  type="checkbox"
                  checked={confirmSource}
                  onChange={(e) => setConfirmSource(e.target.checked)}
                />
                Yes, replace the answer already on file
              </label>
            )}
            <button
              type="button"
              className="desk-button secondary"
              disabled={!heard || saveSource.isPending}
              onClick={() => saveSource.mutate()}
            >
              Save answer
            </button>
            {detail.data?.googleAdsCall && (
              <div className="desk-note">
                <p>
                  {detail.data.googleAdsCall.linked
                    ? "A matching Google ad call is linked automatically."
                    : "We found a matching call from a Google ad."}
                </p>
                {!detail.data.googleAdsCall.linked && (
                  <button
                    type="button"
                    className="desk-text-button"
                    disabled={linkCall.isPending}
                    onClick={() => linkCall.mutate()}
                  >
                    Match this call
                  </button>
                )}
              </div>
            )}
          </details>
          <details className="desk-form-card desk-details">
            <summary>
              Customer texts <span>{detail.data?.messages.length || "None yet"}</span>
            </summary>
            {!detail.data?.messages.length ? (
              <p className="desk-note">No customer texts yet.</p>
            ) : (
              <ol className="desk-history">
                {detail.data.messages.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.direction === "inbound" ? "Customer" : "Boltz"} ·{" "}
                      {appointmentLabel(item.createdAt)}
                    </span>
                    <p>{item.body || "Attachment"}</p>
                  </li>
                ))}
              </ol>
            )}
          </details>
          <details className="desk-form-card desk-details">
            <summary>Payments & history</summary>
            <p className="desk-note">Payments update automatically when Square matches them.</p>
            <p>
              {lead.squarePaidAt || lead.squareGrossCents > 0
                ? `Payment received · ${money(lead.squareGrossCents)}`
                : "No matched payment yet."}
            </p>
            <ol className="desk-history">
              {detail.data?.events.map((event) => (
                <li key={event.id}>
                  <span>{appointmentLabel(event.createdAt)}</span>
                  <p>{event.summary || event.eventType.replace(/_/g, " ")}</p>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </DeskShell>
  );
}
