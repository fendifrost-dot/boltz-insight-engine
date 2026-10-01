// Which Pages reconciliation lists Instant Forms for. Public Page ids only.

/** Page subscribed for leadgen. Always scanned. */
export const SUBSCRIBED_LEADGEN_PAGE_ID = "433712466491882";

/**
 * Second Boltz Page. Always scanned. It is not in the live META_PAGE_ID value,
 * so a newer Instant Form that lives only here was invisible to reconciliation.
 */
export const DUPLICATE_LEADGEN_PAGE_ID = "101035642014297";

const PAGE_ID = /^\d{5,32}$/;

export type LeadgenPage = {
  pageId: string;
  reason: "subscribed" | "known_duplicate" | "configured";
};

/** Splits a comma- or whitespace-separated list of Page ids. Drops anything else. */
export function parsePageIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const ids: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const id = part.trim();
    if (!PAGE_ID.test(id) || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Subscribed Page, then the known duplicate Page, then any other id in
 * META_PAGE_ID. Ids are de-duplicated. The duplicate Page does not require a
 * secret change to be scanned.
 */
export function leadgenPagesToScan(configured: readonly string[]): LeadgenPage[] {
  const pages: LeadgenPage[] = [
    { pageId: SUBSCRIBED_LEADGEN_PAGE_ID, reason: "subscribed" },
    { pageId: DUPLICATE_LEADGEN_PAGE_ID, reason: "known_duplicate" },
  ];
  for (const id of configured) {
    if (!PAGE_ID.test(id) || pages.some((page) => page.pageId === id)) continue;
    pages.push({ pageId: id, reason: "configured" });
  }
  return pages;
}
