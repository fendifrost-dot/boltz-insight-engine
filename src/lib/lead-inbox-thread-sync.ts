/**
 * SMS-safety helpers for Lead Inbox selection ↔ thread pane sync.
 * A highlighted row must never allow send to a different loaded conversation.
 * Selection is always by lead id + phone — never list index.
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
  /** Row highlight / intended selection (lead id from the clicked row) */
  selectedLeadId: string | null;
  /** Phone from the clicked list row — send must match this, not list position */
  selectedRowPhone: string | null;
  /** Name from the clicked list row — shown in the thread header immediately */
  selectedRowName: string | null;
  /** Lead record from the loaded getThread payload */
  loadedLead: ThreadSyncLead | null | undefined;
  /** Thread record from the loaded getThread payload */
  loadedThread: ThreadSyncThread | null | undefined;
  /** True while the selected lead's thread query has not settled with matching data */
  threadQueryPending: boolean;
};

export type ThreadSyncState = {
  /** Selection and loaded payload agree; safe to show history as authoritative */
  inSync: boolean;
  /** Show loading UI (pending fetch or highlight/loaded mismatch) */
  showLoading: boolean;
  /** Block compose/send until in sync with a destination phone */
  canCompose: boolean;
  /**
   * Destination phone for the visible header.
   * Prefer the clicked row phone immediately; only enable send when loaded matches it.
   */
  destinationPhone: string | null;
  headerName: string | null;
  blockReason: string | null;
};

/** Digits-only E.164-ish form for comparisons (10-digit US → 1XXXXXXXXXX). */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.length === 10 ? `1${digits}` : digits;
}

/** Pretty +1 (312) 555-0100 display for the thread header / Send button. */
export function displayPhone(raw: string | null | undefined): string {
  const digits = normalizePhone(raw);
  if (!digits) return "Not entered";
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return `+${digits}`;
}

/**
 * Derive UI/send readiness from selection + loaded thread payload.
 * Send is only allowed when clicked-row phone, loaded lead, and thread phone all agree.
 */
export function resolveThreadSync(snapshot: ThreadSyncSnapshot): ThreadSyncState {
  const selectedLeadId = snapshot.selectedLeadId;
  const selectedPhone = normalizePhone(snapshot.selectedRowPhone);
  const selectedName = snapshot.selectedRowName?.trim() || null;

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

  // Header always reflects the clicked row so operators can verify destination
  // even while the thread is still loading.
  const pendingHeader = {
    destinationPhone: selectedPhone,
    headerName: selectedName ?? "Unnamed",
  };

  if (snapshot.threadQueryPending) {
    return {
      inSync: false,
      showLoading: true,
      canCompose: false,
      ...pendingHeader,
      blockReason: "Loading the selected conversation…",
    };
  }

  const loadedLead = snapshot.loadedLead ?? null;
  const loadedThread = snapshot.loadedThread ?? null;

  if (!loadedLead || !loadedThread) {
    return {
      inSync: false,
      showLoading: false,
      canCompose: false,
      ...pendingHeader,
      blockReason: "Thread not loaded for this lead",
    };
  }

  if (loadedLead.id !== selectedLeadId) {
    return {
      inSync: false,
      showLoading: true,
      canCompose: false,
      ...pendingHeader,
      blockReason: "Highlighted lead does not match loaded conversation — reloading…",
    };
  }

  if (loadedThread.lead_id !== selectedLeadId || loadedThread.lead_id !== loadedLead.id) {
    return {
      inSync: false,
      showLoading: false,
      canCompose: false,
      ...pendingHeader,
      blockReason: "Thread does not belong to the selected lead — send blocked",
    };
  }

  const leadPhone = normalizePhone(loadedLead.phone_e164);
  const threadPhone = normalizePhone(loadedThread.phone_e164);
  const destinationPhone = leadPhone ?? threadPhone;

  if (!destinationPhone || !selectedPhone) {
    return {
      inSync: false,
      showLoading: false,
      canCompose: false,
      destinationPhone: selectedPhone,
      headerName: selectedName ?? loadedLead.name ?? "Unnamed",
      blockReason: "Lead has no phone number — send blocked",
    };
  }

  // Critical: clicked-row phone must match the loaded lead/thread phone.
  if (selectedPhone !== destinationPhone) {
    return {
      inSync: false,
      showLoading: false,
      canCompose: false,
      destinationPhone: selectedPhone,
      headerName: selectedName ?? loadedLead.name ?? "Unnamed",
      blockReason: "Row phone does not match loaded thread phone — send blocked",
    };
  }

  if (leadPhone && threadPhone && leadPhone !== threadPhone) {
    return {
      inSync: false,
      showLoading: false,
      canCompose: false,
      destinationPhone: selectedPhone,
      headerName: selectedName ?? loadedLead.name ?? "Unnamed",
      blockReason: "Lead and thread phone disagree — send blocked",
    };
  }

  return {
    inSync: true,
    showLoading: false,
    canCompose: true,
    destinationPhone,
    headerName: selectedName ?? loadedLead.name ?? "Unnamed",
    blockReason: null,
  };
}

/**
 * Server/UI guard: refuse send when the operator's intended lead/thread/phone
 * do not form one coherent destination (row A must never send to conversation B).
 */
export function assertSendDestination(args: {
  selectedLeadId: string;
  selectedRowPhone: string;
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
  const rowPhone = normalizePhone(args.selectedRowPhone);
  const dest = normalizePhone(args.destinationPhone);
  const header = normalizePhone(args.headerPhone);
  if (!rowPhone || !dest || !header) {
    return { ok: false, reason: "Missing destination phone" };
  }
  if (rowPhone !== dest || dest !== header) {
    return { ok: false, reason: "Send destination does not match visible thread header phone" };
  }
  return { ok: true };
}
