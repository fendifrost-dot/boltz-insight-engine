/**
 * PROPOSAL SCAFFOLDING — all flags default OFF.
 *
 * This folder is not imported by the Lead Inbox send path, cron routes, or
 * RingCentral helpers. Flipping a flag in this file does nothing until a later,
 * owner-approved PR wires a job. See README.md in this directory.
 */

export const CUSTOMER_OUTREACH_ENABLED = false;
export const CUSTOMER_OUTREACH_SQUARE_SYNC_ENABLED = false;
export const CUSTOMER_OUTREACH_SEND_ENABLED = false;
export const CUSTOMER_OUTREACH_CHECKIN_ENABLED = false;

export type OutreachFlagName =
  | "CUSTOMER_OUTREACH_ENABLED"
  | "CUSTOMER_OUTREACH_SQUARE_SYNC_ENABLED"
  | "CUSTOMER_OUTREACH_SEND_ENABLED"
  | "CUSTOMER_OUTREACH_CHECKIN_ENABLED";

export const OUTREACH_FLAGS: Record<OutreachFlagName, boolean> = {
  CUSTOMER_OUTREACH_ENABLED,
  CUSTOMER_OUTREACH_SQUARE_SYNC_ENABLED,
  CUSTOMER_OUTREACH_SEND_ENABLED,
  CUSTOMER_OUTREACH_CHECKIN_ENABLED,
};

/** Hard stop. Nothing in this proposal PR is allowed to send SMS. */
export function assertOutreachSendAllowed(): never {
  throw new Error(
    "Customer outreach sending is not built. This proposal PR cannot text customers. " +
      "See docs/proposals/2026-09-03-maintenance-reminders-and-checkins.md",
  );
}
