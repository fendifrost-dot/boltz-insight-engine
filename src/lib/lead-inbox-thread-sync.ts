// Pure helpers guaranteeing the composer can only ever send to the thread that is
// actually loaded and visible. Row A must never be able to text conversation B.

export type SyncLead = {
  id: string;
  name?: string | null;
  phone_e164?: string | null;
} | null | undefined;

export type SyncThread = {
  id: string;
  lead_id: string;
  phone_e164?: string | null;
} | null | undefined;

export type ThreadSync = {
  inSync: boolean;
  showLoading: boolean;
  canCompose: boolean;
  destinationPhone: string | null;
  headerName: string;
  blockReason: string | null;
};

/** Digits-only comparison form; returns null when there is nothing usable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function resolveThreadSync(input: {
  selectedLeadId: string | null;
  selectedRowPhone?: string | null;
  selectedRowName?: string | null;
  loadedLead: SyncLead;
  loadedThread: SyncThread;
  threadQueryPending: boolean;
}): ThreadSync {
  const {
    selectedLeadId,
    selectedRowPhone = null,
    selectedRowName = null,
    loadedLead,
    loadedThread,
    threadQueryPending,
  } = input;

  const rowPhone = normalizePhone(selectedRowPhone);
  // Identity header ALWAYS comes from the clicked row, even while loading.
  const rowName = selectedRowName ?? (loadedLead?.id === selectedLeadId ? loadedLead?.name : null) ?? "Unnamed";

  const blocked = (blockReason: string | null, showLoading: boolean): ThreadSync => ({
    inSync: false,
    showLoading,
    canCompose: false,
    destinationPhone: rowPhone,
    headerName: selectedLeadId ? rowName : "",
    blockReason,
  });

  if (!selectedLeadId) return blocked(null, false);
  if (threadQueryPending) return blocked("Loading the selected conversation…", true);
  if (!loadedLead) return blocked("Loading the selected conversation…", true);
  if (loadedLead.id !== selectedLeadId) {
    return blocked(
      "Highlighted lead does not match the loaded conversation — reloading before any send.",
      true,
    );
  }

  const leadPhone = normalizePhone(loadedLead.phone_e164);
  const threadPhone = normalizePhone(loadedThread?.phone_e164);

  if (!loadedThread) {
    return {
      inSync: true,
      showLoading: false,
      canCompose: false,
      destinationPhone: rowPhone ?? leadPhone,
      headerName: rowName,
      blockReason: "No SMS thread exists for this lead yet — use New SMS to start one.",
    };
  }
  if (loadedThread.lead_id !== loadedLead.id) {
    return blocked("Loaded thread belongs to a different lead — send blocked.", false);
  }
  if (!leadPhone) {
    return {
      inSync: true,
      showLoading: false,
      canCompose: false,
      destinationPhone: rowPhone,
      headerName: rowName,
      blockReason: "Lead has no phone number — send blocked.",
    };
  }
  if (rowPhone && rowPhone !== leadPhone) {
    return blocked(
      "Selected row phone does not match the loaded conversation — send blocked.",
      false,
    );
  }
  if (threadPhone && threadPhone !== leadPhone) {
    return blocked("Lead phone and thread phone disagree — send blocked.", false);
  }

  return {
    inSync: true,
    showLoading: false,
    canCompose: true,
    destinationPhone: rowPhone ?? leadPhone,
    headerName: rowName,
    blockReason: null,
  };
}


export type SendAssertion = { ok: true; leadId: string; threadId: string; phone: string } | {
  ok: false;
  reason: string;
};

export function assertSendDestination(input: {
  selectedLeadId: string | null;
  loadedLead: SyncLead;
  loadedThread: SyncThread;
  headerPhone: string | null;
}): SendAssertion {
  const { selectedLeadId, loadedLead, loadedThread, headerPhone } = input;
  if (!selectedLeadId || !loadedLead || !loadedThread) {
    return { ok: false, reason: "No conversation loaded — send blocked." };
  }
  if (loadedLead.id !== selectedLeadId) {
    return { ok: false, reason: "Highlighted lead does not match the loaded conversation — send blocked." };
  }
  if (loadedThread.lead_id !== loadedLead.id) {
    return { ok: false, reason: "Loaded thread belongs to a different lead — send blocked." };
  }
  const leadPhone = normalizePhone(loadedLead.phone_e164);
  const wanted = normalizePhone(headerPhone);
  if (!leadPhone) return { ok: false, reason: "Lead has no phone number — send blocked." };
  if (!wanted || wanted !== leadPhone) {
    return { ok: false, reason: "Destination phone does not match the visible conversation — send blocked." };
  }
  const threadPhone = normalizePhone(loadedThread.phone_e164);
  if (threadPhone && threadPhone !== leadPhone) {
    return { ok: false, reason: "Lead phone and thread phone disagree — send blocked." };
  }
  return { ok: true, leadId: loadedLead.id, threadId: loadedThread.id, phone: leadPhone };
}

/** Pretty +1 (312) 555-0100 style display for the "Sending to" header. */
export function displayPhone(raw: string | null | undefined): string {
  const digits = normalizePhone(raw);
  if (!digits) return "Not entered";
  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return `+${digits}`;
}
