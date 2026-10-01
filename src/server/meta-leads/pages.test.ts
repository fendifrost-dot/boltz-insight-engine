import test from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_LEADGEN_PAGE_ID,
  SUBSCRIBED_LEADGEN_PAGE_ID,
  leadgenPagesToScan,
  parsePageIdList,
} from "./pages.ts";

test("parsePageIdList keeps numeric page ids and drops anything else", () => {
  assert.deepEqual(parsePageIdList("433712466491882, 101035642014297"), [
    SUBSCRIBED_LEADGEN_PAGE_ID,
    DUPLICATE_LEADGEN_PAGE_ID,
  ]);
  assert.deepEqual(parsePageIdList("433712466491882,not-a-page"), [SUBSCRIBED_LEADGEN_PAGE_ID]);
  assert.deepEqual(parsePageIdList(undefined), []);
});

test("the subscribed page and the known duplicate page are always scanned", () => {
  assert.deepEqual(
    leadgenPagesToScan([]).map((page) => [page.pageId, page.reason]),
    [
      [SUBSCRIBED_LEADGEN_PAGE_ID, "subscribed"],
      [DUPLICATE_LEADGEN_PAGE_ID, "known_duplicate"],
    ],
  );
  assert.deepEqual(
    leadgenPagesToScan([SUBSCRIBED_LEADGEN_PAGE_ID]).map((page) => page.pageId),
    [SUBSCRIBED_LEADGEN_PAGE_ID, DUPLICATE_LEADGEN_PAGE_ID],
  );
  assert.deepEqual(
    leadgenPagesToScan([DUPLICATE_LEADGEN_PAGE_ID]).map((page) => page.pageId),
    [SUBSCRIBED_LEADGEN_PAGE_ID, DUPLICATE_LEADGEN_PAGE_ID],
  );
  assert.deepEqual(
    leadgenPagesToScan(["555000111222333"]).map((page) => [page.pageId, page.reason]),
    [
      [SUBSCRIBED_LEADGEN_PAGE_ID, "subscribed"],
      [DUPLICATE_LEADGEN_PAGE_ID, "known_duplicate"],
      ["555000111222333", "configured"],
    ],
  );
});
