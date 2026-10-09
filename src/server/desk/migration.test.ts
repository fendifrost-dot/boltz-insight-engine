import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = readFileSync(join(root, "supabase/migrations/20261009183000_shop_desk.sql"), "utf8");

test("shop desk migration forces RLS on caller numbers and blocks staff from Paid", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.google_ads_call_numbers/);
  assert.match(sql, /phone_e164 ~ '\^\\\+\[1-9\]\[0-9\]\{7,14\}\$'/);
  assert.match(sql, /REFERENCES public\.ads_call_weekly \(id\)/);
  assert.match(sql, /ALTER TABLE public\.google_ads_call_numbers ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.google_ads_call_numbers FORCE ROW LEVEL SECURITY/);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.google_ads_call_numbers FROM PUBLIC, anon, authenticated/,
  );
  assert.match(sql, /GRANT ALL ON TABLE public\.google_ads_call_numbers TO service_role/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.doesNotMatch(sql, /TO authenticated/i);
  assert.match(sql, /intake_path = 'desk'/);
  assert.match(sql, /'walk_in', 'phone'/);
  assert.match(sql, /created_by uuid/);
  assert.match(sql, /REFERENCES auth\.users \(id\) ON DELETE SET NULL/);
  assert.match(sql, /Only the system payment path may mark a lead Paid/);
  assert.match(sql, /jwt_role = 'service_role'/);
  assert.match(sql, /ads_call_weekly remains aggregate counts/);
  assert.doesNotMatch(sql, /caller_area_code|caller_country_code/);
  assert.doesNotMatch(sql, /INSERT INTO public\.google_ads_call_numbers/i);
  assert.doesNotMatch(sql, /shop_assistant/);
});

const claimsSql = readFileSync(
  join(root, "supabase/migrations/20261009193000_protect_desk_columns_jwt_claims.sql"),
  "utf8",
);

test("desk guard reads the JWT role from request.jwt.claims and the legacy GUC", () => {
  const compact = claimsSql.replace(/\s+/g, " ");
  assert.match(compact, /CREATE OR REPLACE FUNCTION public\.protect_lead_desk_columns\(\)/);
  assert.match(
    compact,
    /coalesce\(\s*nullif\(current_setting\('request\.jwt\.claim\.role', true\), ''\),\s*nullif\(current_setting\('request\.jwt\.claims', true\), ''\)::jsonb->>'role'\s*\)/,
  );
  assert.match(compact, /jwt_role IS NULL OR jwt_role = 'service_role'/);
  assert.match(compact, /Only the system payment path may mark a lead Paid/);
  assert.match(compact, /Desk leads are recorded by the shop desk/);
  assert.match(compact, /created_by is assigned by the shop desk/);
  assert.match(compact, /Google Ads call links are assigned by the shop desk/);
  assert.match(compact, /Desk idempotency is assigned by the shop desk/);
  assert.match(compact, /SET search_path = public/);
  assert.match(
    compact,
    /REVOKE ALL ON FUNCTION public\.protect_lead_desk_columns\(\) FROM PUBLIC, anon, authenticated/,
  );
  assert.doesNotMatch(claimsSql, /TO authenticated/i);
  assert.doesNotMatch(claimsSql, /shop_assistant/);
});
