import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = readFileSync(join(root, "supabase/migrations/20261009120000_square.sql"), "utf8");

const TABLES = [
  "square_sync_state",
  "square_webhook_events",
  "square_customers",
  "square_payments",
  "square_refunds",
  "square_orders",
  "square_order_line_items",
  "square_invoices",
  "square_catalog_items",
];

test("Square tables are forced behind RLS with no browser grants", () => {
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`'${table}'`));
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT ALL ON TABLE public\.%I TO service_role/);
  assert.match(sql, /square_payments \(/);
  assert.match(sql, /square_id text PRIMARY KEY/);
  assert.match(sql, /card_last4 text CHECK/);
  assert.doesNotMatch(sql, /fingerprint/i);
  assert.doesNotMatch(sql, /given_name/i);
  assert.doesNotMatch(sql, /family_name/i);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /EAAA/);
  assert.match(sql, /square_revenue_weekly/);
  assert.match(sql, /America\/Chicago/);
  assert.match(sql, /REVOKE ALL ON public\.square_revenue_weekly FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /square_gross_cents/);
  assert.match(sql, /square_net numeric/);
});
