import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { checkCapability, requireCapability } from "@/server/authz/require-capability.server";
import {
  DESK_ADS_CALL_LOOKBACK_MS,
  DESK_HEARD_ABOUT,
  DESK_LEAD_LIST_COLUMNS,
  appendDeskNote,
  attachAdsCallDecision,
  attributionUpdate,
  decideDeskIntake,
  deskActor,
  deskAdsLinkEvent,
  deskNoteEvent,
  deskSearchOr,
  deskSearchPlan,
  normalizeDeskIntake,
  phoneIntakeDisposition,
  pickGoogleAdsCall,
  toDeskLeadCard,
  type AdsCallHit,
  type AdsCallLink,
  type DeskLeadCard,
} from "@/lib/desk-intake";

/**
 * Shop desk authorization:
 * - every handler uses requireSupabaseAuth, then requireCapability, before service-role work.
 * - create / note: contacts.write. List / detail: contacts.read.
 * - attribution and Ads-call link: attribution.correct.
 * - Paid is not a desk action. Lifecycle moves use transitionLeadLifecycle.
 * Lead, thread, and message reads use the staff JWT (RLS). Caller-number lookup
 * uses service role because google_ads_call_numbers is not granted to the browser.
 */

const intakeSchema = z.object({
  channel: z.enum(["walk_in", "phone"]),
  name: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  vehicleYear: z.number().int().min(1900).max(2100).nullable().optional(),
  vehicleMake: z.string().max(40).optional(),
  vehicleModel: z.string().max(40).optional(),
  concern: z.string().max(2000).optional(),
  heardAbout: z.enum(DESK_HEARD_ABOUT),
  heardAboutOther: z.string().max(80).optional(),
  appointmentInterest: z.boolean(),
  notes: z.string().max(2000).optional(),
  idempotencyKey: z.string().uuid(),
});

const heardSchema = z.object({
  leadId: z.string().uuid(),
  heardAbout: z.enum(DESK_HEARD_ABOUT),
  heardAboutOther: z.string().max(80).optional(),
  confirm: z.boolean().default(false),
});

type LeadUpdate = Database["public"]["Tables"]["leads"]["Update"];

function uniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function hitsFrom(
  rows: {
    id: string;
    started_at: string;
    week_start: string;
    ads_call_weekly_id: string | null;
  }[],
): AdsCallHit[] {
  return rows.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    weekStart: row.week_start,
    adsCallWeeklyId: row.ads_call_weekly_id,
  }));
}

async function loadAdsHits(phone: string, now: Date): Promise<AdsCallHit[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(now.getTime() - DESK_ADS_CALL_LOOKBACK_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("google_ads_call_numbers")
    .select("id, started_at, week_start, ads_call_weekly_id")
    .eq("phone_e164", phone)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(5);
  if (error || !data) {
    if (error) console.error("desk ads call lookup failed");
    return [];
  }
  return hitsFrom(data);
}

async function loadLinkedCall(callId: string): Promise<AdsCallLink | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("google_ads_call_numbers")
    .select("id, started_at, week_start, ads_call_weekly_id")
    .eq("id", callId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("desk ads call lookup failed");
    return null;
  }
  return {
    id: data.id,
    startedAt: data.started_at,
    weekStart: data.week_start,
    adsCallWeeklyId: data.ads_call_weekly_id,
  };
}

type SaveOk = {
  ok: true;
  status: "created" | "duplicate" | "existing" | "idempotent";
  leadId: string;
  leadSource: string | null;
  name: string | null;
  lifecycle: string | null;
  googleAdsCall: AdsCallLink | null;
};

export const createDeskLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => intakeSchema.parse(input))
  .handler(async ({ data, context }): Promise<SaveOk | { ok: false; reason: string }> => {
    await requireCapability(context, "contacts.write");
    const isOwner = await checkCapability(context, "integrations.manage");
    const now = new Date();
    const normalized = normalizeDeskIntake(data, now, context.userId);
    if (!normalized.ok) return { ok: false, reason: normalized.reason };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const intake = normalized.normalized;

    const idempotent = await supabaseAdmin
      .from("leads")
      .select("id, lead_source, name, lifecycle")
      .eq("desk_idempotency_key", intake.idempotencyKey)
      .maybeSingle();
    if (idempotent.error) {
      console.error("createDeskLead lookup failed");
      return { ok: false, reason: "Could not save the lead" };
    }

    const existing = intake.phone
      ? await supabaseAdmin
          .from("leads")
          .select("id, created_at, lead_source, name, lifecycle, google_ads_call_id")
          .eq("phone_e164", intake.phone)
          .maybeSingle()
      : { data: null, error: null };
    if (existing.error) {
      console.error("createDeskLead phone lookup failed");
      return { ok: false, reason: "Could not save the lead" };
    }

    const adsHits =
      intake.channel === "phone" && intake.phone ? await loadAdsHits(intake.phone, now) : [];
    const decision = decideDeskIntake({
      intake,
      actor: deskActor(isOwner, context.userId),
      existing: existing.data
        ? { id: existing.data.id, createdAt: existing.data.created_at }
        : null,
      idempotentLeadId: idempotent.data?.id ?? null,
      adsHits,
    });
    if (!decision.ok) return { ok: false, reason: decision.reason };

    const plan = decision.plan;
    if (plan.action !== "create") {
      let leadSource =
        (plan.action === "idempotent" ? idempotent.data : existing.data)?.lead_source ?? null;
      const row = plan.action === "idempotent" ? idempotent.data : existing.data;
      if (
        plan.action !== "idempotent" &&
        plan.googleAdsCall &&
        intake.channel === "phone" &&
        existing.data &&
        existing.data.google_ads_call_id !== plan.googleAdsCall.id
      ) {
        const attached = attachAdsCallDecision({
          currentSource: existing.data.lead_source,
          match: plan.googleAdsCall,
        });
        if (attached.ok) {
          const patch: LeadUpdate = { google_ads_call_id: attached.callId };
          if (attached.leadSource) {
            patch.lead_source = attached.leadSource;
            leadSource = attached.leadSource;
          }
          if (attached.heardAbout) patch.heard_about = attached.heardAbout;
          const linked = await supabaseAdmin.from("leads").update(patch).eq("id", existing.data.id);
          if (linked.error) console.error("createDeskLead ads link failed");
          else {
            const event = deskAdsLinkEvent(
              deskActor(isOwner, context.userId),
              plan.googleAdsCall.weekStart,
            );
            const eventInsert = await supabaseAdmin.from("lead_events").insert({
              lead_id: existing.data.id,
              event_type: event.event_type,
              actor: event.actor,
              summary: event.summary,
              metadata: event.metadata,
            });
            if (eventInsert.error) console.error("createDeskLead ads link event failed");
          }
        }
      }
      return {
        ok: true,
        status: plan.action,
        leadId: plan.leadId,
        leadSource,
        name: row?.name ?? null,
        lifecycle: row?.lifecycle ?? null,
        googleAdsCall: plan.googleAdsCall,
      };
    }

    const inserted = await supabaseAdmin.from("leads").insert(plan.row).select("id").single();
    if (inserted.error || !inserted.data) {
      if (uniqueViolation(inserted.error)) {
        const again = intake.phone
          ? await supabaseAdmin
              .from("leads")
              .select("id, created_at, lead_source, name, lifecycle")
              .eq("phone_e164", intake.phone)
              .maybeSingle()
          : await supabaseAdmin
              .from("leads")
              .select("id, created_at, lead_source, name, lifecycle")
              .eq("desk_idempotency_key", intake.idempotencyKey)
              .maybeSingle();
        if (again.data) {
          const disposition = phoneIntakeDisposition({
            existingCreatedAt: again.data.created_at,
            now,
          });
          return {
            ok: true,
            status: disposition === "new" ? "existing" : disposition,
            leadId: again.data.id,
            leadSource: again.data.lead_source,
            name: again.data.name,
            lifecycle: again.data.lifecycle,
            googleAdsCall: plan.googleAdsCall,
          };
        }
      }
      console.error("createDeskLead insert failed");
      return { ok: false, reason: "Could not save the lead" };
    }

    const eventInsert = await supabaseAdmin.from("lead_events").insert({
      lead_id: inserted.data.id,
      event_type: plan.event.event_type,
      actor: plan.event.actor,
      summary: plan.event.summary,
      metadata: plan.event.metadata as Json,
    });
    if (eventInsert.error) console.error("createDeskLead event failed");

    return {
      ok: true,
      status: "created",
      leadId: inserted.data.id,
      leadSource: plan.row.lead_source,
      name: plan.row.name,
      lifecycle: "New",
      googleAdsCall: plan.googleAdsCall,
    };
  });

export const listDeskLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ query: z.string().max(80).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }): Promise<DeskLeadCard[]> => {
    await requireCapability(context, "contacts.read");
    try {
      const plan = deskSearchPlan(data.query ?? "");
      let request = context.supabase.from("leads").select(DESK_LEAD_LIST_COLUMNS);
      if (plan.phoneExact) request = request.eq("phone_e164", plan.phoneExact);
      else {
        const orFilter = deskSearchOr(plan);
        if (orFilter) request = request.or(orFilter);
      }
      const { data: rows, error } = await request
        .order("created_at", { ascending: false })
        .limit(40);
      if (error || !rows) {
        console.error("listDeskLeads failed");
        return [];
      }
      return rows.map((row) => toDeskLeadCard(row));
    } catch {
      console.error("listDeskLeads failed");
      return [];
    }
  });

export const getDeskLead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireCapability(context, "contacts.read");
    const [leadRes, threadRes, eventsRes] = await Promise.all([
      context.supabase
        .from("leads")
        .select(DESK_LEAD_LIST_COLUMNS)
        .eq("id", data.leadId)
        .maybeSingle(),
      context.supabase
        .from("message_threads")
        .select("id")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("lead_events")
        .select("id, event_type, summary, created_at, from_lifecycle, to_lifecycle")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    if (leadRes.error || !leadRes.data) {
      if (leadRes.error) console.error("getDeskLead failed");
      return null;
    }

    const threadId = threadRes.data?.id ?? null;
    const messagesRes = threadId
      ? await context.supabase
          .from("messages")
          .select("id, direction, body, created_at, channel")
          .eq("thread_id", threadId)
          .order("created_at", { ascending: true })
          .limit(100)
      : { data: [], error: null };
    if (messagesRes.error || eventsRes.error) console.error("getDeskLead thread failed");

    const card = toDeskLeadCard(leadRes.data);
    const now = new Date();
    let googleAdsCall: (AdsCallLink & { linked: boolean }) | null = null;
    if (card.googleAdsCallId) {
      const linked = await loadLinkedCall(card.googleAdsCallId);
      if (linked) googleAdsCall = { ...linked, linked: true };
    }
    if (!googleAdsCall && card.phone && card.intakeChannel !== "walk_in") {
      const match = pickGoogleAdsCall({
        channel: "phone",
        hits: await loadAdsHits(card.phone, now),
        now,
      });
      if (match) googleAdsCall = { ...match, linked: false };
    }

    return {
      lead: card,
      messages: (messagesRes.data ?? []).map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        createdAt: message.created_at,
        channel: message.channel,
      })),
      events: (eventsRes.data ?? []).map((event) => ({
        id: event.id,
        eventType: event.event_type,
        summary: event.summary,
        createdAt: event.created_at,
        fromLifecycle: event.from_lifecycle,
        toLifecycle: event.to_lifecycle,
      })),
      googleAdsCall,
    };
  });

export const addDeskNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ leadId: z.string().uuid(), note: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCapability(context, "contacts.write");
    const isOwner = await checkCapability(context, "integrations.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const current = await supabaseAdmin
      .from("leads")
      .select("id, notes")
      .eq("id", data.leadId)
      .maybeSingle();
    if (current.error || !current.data) {
      console.error("addDeskNote lookup failed");
      return { ok: false as const, reason: "Lead not found" };
    }
    const appended = appendDeskNote(current.data.notes, data.note, new Date());
    if (!appended.ok) return { ok: false as const, reason: appended.reason };
    const updated = await supabaseAdmin
      .from("leads")
      .update({ notes: appended.notes })
      .eq("id", data.leadId);
    if (updated.error) {
      console.error("addDeskNote update failed");
      return { ok: false as const, reason: "Could not save the note" };
    }
    const event = deskNoteEvent(data.note.trim().length, deskActor(isOwner, context.userId));
    const eventInsert = await supabaseAdmin.from("lead_events").insert({
      lead_id: data.leadId,
      event_type: event.event_type,
      actor: event.actor,
      summary: event.summary,
      metadata: event.metadata,
    });
    if (eventInsert.error) console.error("addDeskNote event failed");
    return { ok: true as const, reason: null };
  });

export const setDeskAttribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => heardSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireCapability(context, "attribution.correct");
    const isOwner = await checkCapability(context, "integrations.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const current = await supabaseAdmin
      .from("leads")
      .select("id, lead_source, heard_about, phone_e164, intake_channel")
      .eq("id", data.leadId)
      .maybeSingle();
    if (current.error || !current.data) {
      console.error("setDeskAttribution lookup failed");
      return { ok: false as const, reason: "Lead not found" };
    }
    const now = new Date();
    const phone = current.data.phone_e164;
    const walkIn = current.data.intake_channel === "walk_in";
    const match =
      phone && !walkIn
        ? pickGoogleAdsCall({
            channel: "phone",
            hits: await loadAdsHits(phone, now),
            now,
          })
        : null;
    const decided = attributionUpdate({
      currentSource: current.data.lead_source,
      heardAbout: data.heardAbout,
      otherText: data.heardAboutOther ?? null,
      googleAdsCallMatched: data.heardAbout === "google" && Boolean(match),
      confirm: data.confirm,
    });
    if (!decided.ok) return { ok: false as const, reason: decided.reason };

    const patch: LeadUpdate = {
      lead_source: decided.leadSource,
      heard_about: decided.heardAbout,
    };
    if (match && data.heardAbout === "google") patch.google_ads_call_id = match.id;
    const updated = await supabaseAdmin.from("leads").update(patch).eq("id", data.leadId);
    if (updated.error) {
      console.error("setDeskAttribution update failed");
      return { ok: false as const, reason: "Could not save attribution" };
    }
    const eventInsert = await supabaseAdmin.from("lead_events").insert({
      lead_id: data.leadId,
      event_type: "desk_attribution",
      actor: deskActor(isOwner, context.userId),
      summary: data.confirm ? "Desk attribution corrected" : "Desk attribution recorded",
      metadata: {
        heard_about: decided.heardAbout,
        google_ads_call_linked: Boolean(match && data.heardAbout === "google"),
      },
    });
    if (eventInsert.error) console.error("setDeskAttribution event failed");
    return {
      ok: true as const,
      reason: null,
      leadSource: decided.leadSource,
      googleAdsCall: match,
    };
  });

export const linkDeskGoogleAdsCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireCapability(context, "attribution.correct");
    const isOwner = await checkCapability(context, "integrations.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const current = await supabaseAdmin
      .from("leads")
      .select("id, lead_source, phone_e164, intake_channel")
      .eq("id", data.leadId)
      .maybeSingle();
    if (current.error || !current.data) {
      console.error("linkDeskGoogleAdsCall lookup failed");
      return { ok: false as const, reason: "Lead not found" };
    }
    const phone = current.data.phone_e164;
    if (!phone || current.data.intake_channel === "walk_in") {
      return { ok: false as const, reason: "No recent Google Ads call matches this phone" };
    }
    const now = new Date();
    const match = pickGoogleAdsCall({
      channel: "phone",
      hits: await loadAdsHits(phone, now),
      now,
    });
    const decided = attachAdsCallDecision({
      currentSource: current.data.lead_source,
      match,
    });
    if (!decided.ok || !match) {
      return {
        ok: false as const,
        reason: decided.ok ? "No recent Google Ads call matches this phone" : decided.reason,
      };
    }
    const patch: LeadUpdate = { google_ads_call_id: decided.callId };
    if (decided.leadSource) patch.lead_source = decided.leadSource;
    if (decided.heardAbout) patch.heard_about = decided.heardAbout;
    const updated = await supabaseAdmin.from("leads").update(patch).eq("id", data.leadId);
    if (updated.error) {
      console.error("linkDeskGoogleAdsCall update failed");
      return { ok: false as const, reason: "Could not link the call" };
    }
    const event = deskAdsLinkEvent(deskActor(isOwner, context.userId), match.weekStart);
    const eventInsert = await supabaseAdmin.from("lead_events").insert({
      lead_id: data.leadId,
      event_type: event.event_type,
      actor: event.actor,
      summary: event.summary,
      metadata: event.metadata,
    });
    if (eventInsert.error) console.error("linkDeskGoogleAdsCall event failed");
    return {
      ok: true as const,
      reason: null,
      leadSource: decided.leadSource ?? current.data.lead_source,
    };
  });
