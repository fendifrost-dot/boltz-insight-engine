// Cursor stepping for Graph edges. Pure so pagination can be tested without HTTP.

export type GraphPaging = {
  next?: string;
  cursors?: { before?: string; after?: string };
};

export type PageStep =
  { kind: "end" } | { kind: "cursor"; after: string } | { kind: "url"; url: string };

/**
 * Meta includes `cursors.after` on the last page and omits `next`. Stop when
 * `next` is absent. A repeated cursor is also the end, so a stuck cursor
 * cannot loop. When `next` is present without a cursor, follow that URL.
 */
export function nextPageCursor(
  paging: GraphPaging | undefined,
  previous: string | undefined,
): PageStep {
  if (!paging?.next) return { kind: "end" };
  const after = paging.cursors?.after;
  if (after) {
    if (after === previous) return { kind: "end" };
    return { kind: "cursor", after };
  }
  return { kind: "url", url: paging.next };
}
