import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { HeardAboutPicker } from "@/components/desk/HeardAboutPicker";
import { EmptyState, PageHeader, Panel, Shell } from "@/components/ops/Shell";
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
      setMessage(`Source saved as ${result.leadSource}.`);
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

  const lead = detail.data?.lead;
  const lifecycle = lead && isLifecycle(lead.lifecycle) ? lead.lifecycle : null;
  const choices = lifecycle ? deskLifecycleChoices(lifecycle) : [];
  const sourceMissing = lead ? !lead.leadSource || !lead.heardAbout : false;
  const vehicle = lead
    ? [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ")
    : "";

  return (
    <Shell>
      <PageHeader
        kicker="Counter"
        title={lead?.name || "Lead"}
        description={lead ? displayPhone(lead.phone) : "Loading the lead."}
        actions={
          <Link to="/desk/leads" className="text-sm font-medium text-primary">
            All leads
          </Link>
        }
      />
      {detail.isError ? (
        <EmptyState label="Could not load this lead" />
      ) : !lead ? (
        <EmptyState label={detail.isPending ? "Loading…" : "Lead not found"} />
      ) : (
        <div className="mx-auto max-w-xl space-y-4">
          <Panel title="Lead">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">{lead.lifecycle}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Source</dt>
                <dd className="text-right font-medium">{lead.leadSource || "Not entered"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Heard about us</dt>
                <dd>
                  {lead.heardAbout && isDeskHeardAbout(lead.heardAbout)
                    ? HEARD_ABOUT_LABEL[lead.heardAbout]
                    : "Not entered"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Path</dt>
                <dd>
                  {lead.intakePath === "desk"
                    ? lead.intakeChannel === "phone"
                      ? "Desk phone"
                      : "Desk walk-in"
                    : "Online"}
                </dd>
              </div>
              {vehicle && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Vehicle</dt>
                  <dd className="text-right">{vehicle}</dd>
                </div>
              )}
              {lead.concern && (
                <div>
                  <dt className="text-muted-foreground">Concern</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{lead.concern}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Square</dt>
                <dd>
                  {lead.squarePaidAt || lead.squareGrossCents > 0
                    ? `Payment matched · ${money(lead.squareGrossCents)}`
                    : "No payment match"}
                </dd>
              </div>
            </dl>
          </Panel>

          {detail.data?.googleAdsCall && (
            <Panel title="Google Ads call">
              <p className="text-sm">
                {detail.data.googleAdsCall.linked
                  ? "This phone is linked to a Google Ads call"
                  : "This phone matches a recent Google Ads call"}
                {detail.data.googleAdsCall.weekStart
                  ? ` from the week of ${detail.data.googleAdsCall.weekStart}`
                  : ""}
                .
              </p>
              {!detail.data.googleAdsCall.linked && (
                <button
                  type="button"
                  onClick={() => linkCall.mutate()}
                  disabled={linkCall.isPending}
                  className="mt-3 min-h-14 w-full rounded-md bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
                >
                  Link Google Ads call
                </button>
              )}
            </Panel>
          )}

          <Panel title="Status">
            <div className="flex flex-wrap gap-2">
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  disabled={moveStatus.isPending}
                  onClick={() => moveStatus.mutate(choice)}
                  className="min-h-12 rounded-md border border-border px-3 text-sm font-medium"
                >
                  {choice}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Staff cannot mark Paid. Square does that when a payment matches.
            </p>
          </Panel>

          <Panel title={sourceMissing ? "How did they hear about us?" : "Source"}>
            {sourceMissing ? (
              <p className="mb-3 text-sm text-muted-foreground">This lead has no source yet.</p>
            ) : (
              <p className="mb-3 text-sm text-muted-foreground">
                Correcting the source changes how Square groups this lead.
              </p>
            )}
            <HeardAboutPicker value={heard} onChange={setHeard} />
            {heard === "other" && (
              <input
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="Short answer"
                className="mt-2 min-h-14 w-full rounded-md border border-border bg-input px-3 text-lg"
              />
            )}
            {!sourceMissing && (
              <label className="mt-3 flex min-h-12 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={confirmSource}
                  onChange={(e) => setConfirmSource(e.target.checked)}
                  className="size-5"
                />
                Confirm source correction
              </label>
            )}
            <button
              type="button"
              disabled={!heard || saveSource.isPending}
              onClick={() => saveSource.mutate()}
              className="mt-3 min-h-14 w-full rounded-md border border-border text-base font-semibold disabled:opacity-60"
            >
              Save source
            </button>
          </Panel>

          <Panel title="Notes">
            {lead.notes ? (
              <p className="mb-3 whitespace-pre-wrap text-sm">{lead.notes}</p>
            ) : (
              <p className="mb-3 text-sm text-muted-foreground">No desk notes yet.</p>
            )}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-input px-3 py-3 text-lg"
            />
            <button
              type="button"
              disabled={saveNote.isPending || !note.trim()}
              onClick={() => saveNote.mutate()}
              className="mt-2 min-h-14 w-full rounded-md bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
            >
              Add note
            </button>
          </Panel>

          <Panel title="Texts">
            {(detail.data?.messages.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                No texts on this lead. Sending stays in the lead inbox.
              </p>
            ) : (
              <ol className="space-y-3">
                {detail.data?.messages.map((message) => (
                  <li key={message.id} className="text-sm">
                    <div className="text-xs text-muted-foreground">
                      {message.direction} · {new Date(message.createdAt).toLocaleString()}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{message.body || "No text"}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Activity">
            {(detail.data?.events.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="space-y-2">
                {detail.data?.events.map((event) => (
                  <li key={event.id} className="text-sm">
                    <span className="text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                    <span className="mt-0.5 block">{event.summary || event.eventType}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}
