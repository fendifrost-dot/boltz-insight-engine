/** Capability names for server-side authorization (see Operations OS handoff §7). */
export type Capability =
  | "contacts.read"
  | "contacts.write"
  | "contacts.merge"
  | "cases.read"
  | "cases.write"
  | "cases.transition"
  | "appointments.manage"
  | "appointments.override_capacity"
  | "communications.draft"
  | "communications.send"
  | "documents.upload"
  | "documents.match"
  | "documents.send"
  | "financial_status.confirm"
  | "financial_exception.approve"
  | "attribution.correct"
  | "integrations.manage"
  | "users.manage"
  | "audit.read";

/** Current production roles in Supabase (`app_role`). Future roles map onto these checks. */
export type StaffRoleCheck = "is_staff" | "owner_only";

const CAPABILITY_ACCESS: Record<Capability, StaffRoleCheck> = {
  "contacts.read": "is_staff",
  "contacts.write": "is_staff",
  "contacts.merge": "owner_only",
  "cases.read": "is_staff",
  "cases.write": "is_staff",
  "cases.transition": "is_staff",
  "appointments.manage": "is_staff",
  "appointments.override_capacity": "owner_only",
  "communications.draft": "is_staff",
  "communications.send": "is_staff",
  "documents.upload": "is_staff",
  "documents.match": "is_staff",
  "documents.send": "is_staff",
  "financial_status.confirm": "owner_only",
  "financial_exception.approve": "owner_only",
  "attribution.correct": "is_staff",
  "integrations.manage": "owner_only",
  "users.manage": "owner_only",
  "audit.read": "is_staff",
};

export function capabilityAccessCheck(capability: Capability): StaffRoleCheck {
  return CAPABILITY_ACCESS[capability];
}

export function capabilityRequiresStaff(capability: Capability): boolean {
  return CAPABILITY_ACCESS[capability] === "is_staff";
}

export function capabilityRequiresOwner(capability: Capability): boolean {
  return CAPABILITY_ACCESS[capability] === "owner_only";
}

export type RoleProbe = {
  isStaff: () => Promise<boolean>;
  isOwner: () => Promise<boolean>;
};

/** Pure capability evaluation for tests and server wrappers. */
export async function checkCapabilityWithProbe(
  probe: RoleProbe,
  capability: Capability,
): Promise<boolean> {
  if (capabilityRequiresOwner(capability)) {
    return probe.isOwner();
  }
  if (capabilityRequiresStaff(capability)) {
    return probe.isStaff();
  }
  return false;
}
