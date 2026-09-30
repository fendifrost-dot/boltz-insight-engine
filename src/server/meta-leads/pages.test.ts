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

test("the subscribed page is always scanned and the duplicate page only when configured", () => {
  assert.deepEqual(
    leadgenPagesToScan([SUBSCRIBED_LEADGEN_PAGE_ID]).map((page) => page.pageId),
    [SUBSCRIBED_LEADGEN_PAGE_ID],
  );
  assert.deepEqual(
    leadgenPagesToScan([DUPLICATE_LEADGEN_PAGE_ID]).map((page) => [page.pageId, page.reason]),
    [
      [SUBSCRIBED_LEADGEN_PAGE_ID, "subscribed"],
      [DUPLICATE_LEADGEN_PAGE_ID, "configured"],
    ],
  );
  assert.deepEqual(
    leadgenPagesToScan([SUBSCRIBED_LEADGEN_PAGE_ID, DUPLICATE_LEADGEN_PAGE_ID]).map(
      (page) => page.pageId,
    ),
    [SUBSCRIBED_LEADGEN_PAGE_ID, DUPLICATE_LEADGEN_PAGE_ID],
  );
  assert.equal(
    leadgenPagesToScan([]).some((page) => page.pageId === DUPLICATE_LEADGEN_PAGE_ID),
    false,
  );
});
