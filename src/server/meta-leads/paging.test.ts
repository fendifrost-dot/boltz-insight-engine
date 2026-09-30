import test from "node:test";
import assert from "node:assert/strict";
import { nextPageCursor } from "./paging.ts";

test("a page with no next cursor is the end, even when after is present", () => {
  assert.deepEqual(nextPageCursor({ cursors: { after: "cursor-1" } }, undefined), { kind: "end" });
});

test("a new after cursor continues the walk", () => {
  assert.deepEqual(
    nextPageCursor(
      { next: "https://graph.facebook.com/next", cursors: { after: "cursor-2" } },
      "cursor-1",
    ),
    { kind: "cursor", after: "cursor-2" },
  );
});

test("a repeated cursor stops the walk", () => {
  assert.deepEqual(
    nextPageCursor(
      { next: "https://graph.facebook.com/next", cursors: { after: "cursor-1" } },
      "cursor-1",
    ),
    { kind: "end" },
  );
});

test("next without a cursor follows the url", () => {
  assert.deepEqual(nextPageCursor({ next: "https://graph.facebook.com/next" }, undefined), {
    kind: "url",
    url: "https://graph.facebook.com/next",
  });
});
