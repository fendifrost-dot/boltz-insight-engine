/**
 * SMS-safety helpers for Lead Inbox selection ↔ thread pane sync.
 * A highlighted row must never allow send to a different loaded conversation.
 */

export type ThreadSyncLead = {
  id: string;
  name?: string | null;
  phone_e164?: string | null;
};

export type ThreadSyncThread = {
  id: string;
  lead_id: string;
  phone_e164?: string | null;
};

export type ThreadSyncSnapshot = {
  /** Row highlight / intended selection */
  selectedLeadId: string | null;
  /** Lead record from the loaded getThread payload (visible header source of truth) */
  loadedLead: ThreadSyncLead | null | undefined;
  /** Thread record from the loaded getThread payload */
  loadedThread: ThreadSyncThread | null | undefined;
  /** True while the selected lead's thread query has not settled with matching data */
  threadQueryPending: boolean;
};

export type ThreadSyncState = {
  /** Selection and loaded payload agree; safe to show composer for that lead */
  inSync: boolean;
  /** Show loading UI (pending fetch or highlight/loaded mismatch) */
  showLoading: boolean;
  /** Block compose/send until in sync with a destination phone */
  canCompose: boolean;
  /** Destination phone from the visible/loaded thread header — never from highlight alone */
  destinationPhone: string | null;
  headerName: string | null;
  blockReason: string | null;
};

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.length === 10 ? `1${digits}` : digits;
}

/**
 * Derive UI/send readiness from selection + loaded thread payload.
 * Send is only allowed when highlight, loaded lead, and thread phone all agree.
 */
export function resolveThreadSync(snapshot: ThreadSyncSnapshot): ThreadSyncState {
  const selectedLeadId = snapshot.selectedLeadId;
  if (!selectedLeadId) {
    return {
      inSync: false,
      showLoading: false,
      canCompose: false,
      destinationPhone: null,
      headerName: null,
      blockReason: "Select a lead",
    };
  }

  if (snapshot.threadQueryPending) {
    return {
      inSync: false,
      showLoading: true,
      canCompose: false,
      destinationPhone: null,
      headerName: null,
      blockReason: "Loading thread…",
    };
  }

  const loadedLead = snapshot.loadedLead ?? null;
  const loadedThread = snapshot.loadedThread ?? null;

  if (!loadedLead || !loadedThread) {
    return {
      inSync: false,
      showLoading: false,
      canCompose: false,
      destinationPhone: null,
      headerName: null,
      blockReason: "Thread not loaded",
    };
  }

  if (loadedLead.id !== selectedLeadId) {
    return {
      inSync: false,
      showLoading: true,
      canCompose: false,
      destinationPhone: null,
      headerName: null,
      blockReason: "Highlight and loaded thread disagree — reloading…",
    };
  }

  if (loadedThread.lead_id !== selectedLeadId || loadedThread.lead_id !== loadedLead.id) {
    return {
      inSync: false,
      showLoading: true,
      canCompose: false,
      destinationPhone: null,
      headerName: null,
      blockReason: "Thread lead mismatch — blocked",
    };
  }

  const leadPhone = normalizePhone(loadedLead.phone_e164);
  const threadPhone = normalizePhone(loadedThread.phone_e164);
  const destinationPhone = leadPhone ?? threadPhone;

  if (!destinationPhone) {
    return {
      inSync: true,
      showLoading: false,
      canCompose: false,
      destinationPhone: null,
      headerName: loadedLead.name ?? null,
      blockReason: "Lead has no phone number",
    };
  }

  if (leadPhone && threadPhone && leadPhone !== threadPhone) {
    return {
      inSync: false,
      showLoading: false,
      canCompose: false,
      destinationPhone: null,
      headerName: loadedLead.name ?? null,
      blockReason: "Lead and thread phone disagree — blocked",
    };
  }

  return {
    inSync: true,
    showLoading: false,
    canCompose: true,
    destinationPhone,
    headerName: loadedLead.name ?? null,
    blockReason: null,
  };
}

/**
 * Server/UI guard: refuse send when the operator's intended lead/thread/phone
 * do not form one coherent destination (row A must never send to conversation B).
 */
export function assertSendDestination(args: {
  selectedLeadId: string;
  loadedLeadId: string;
  loadedThreadId: string;
  loadedThreadLeadId: string;
  destinationPhone: string;
  headerPhone: string;
}): { ok: true } | { ok: false; reason: string } {
  if (args.selectedLeadId !== args.loadedLeadId) {
    return { ok: false, reason: "Selected row does not match loaded thread lead" };
  }
  if (args.loadedThreadLeadId !== args.loadedLeadId) {
    return { ok: false, reason: "Thread does not belong to loaded lead" };
  }
  if (!args.loadedThreadId) {
    return { ok: false, reason: "Missing thread id" };
  }
  const dest = normalizePhone(args.destinationPhone);
  const header = normalizePhone(args.headerPhone);
  if (!dest || !header) {
    return { ok: false, reason: "Missing destination phone" };
  }
  if (dest !== header) {
    return { ok: false, reason: "Send destination does not match visible thread header phone" };
  }
  return { ok: true };
}
