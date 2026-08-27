# Schema baseline and reproducibility

## Problem

Production Boltz Operations OS schema (lead inbox, auth helpers, RLS) was applied through Lovable Cloud before the full DDL existed in git. Incremental migrations under `supabase/migrations/` assumed tables already existed, so a **fresh database could not be bootstrapped from git alone**.

Authoritative references today:

| Source | Role |
|--------|------|
| `docs/schema/production-export.json` | **Authoritative** read-only export from live production queries |
| `docs/schema/production-inventory.json` | Curated inventory derived from `production-export.json` |
| `src/integrations/supabase/types.ts` | Generated client types (enums only; not sufficient alone) |
| `supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql` | Additive adoption baseline |

## Baseline migration

`20260825155900_baseline_ops_schema_adoption.sql` is **additive only**:

- `CREATE EXTENSION/TABLE/INDEX … IF NOT EXISTS`
- Enum creation wrapped in `duplicate_object` handlers
- `CREATE OR REPLACE FUNCTION`
- `DROP POLICY IF EXISTS` then `CREATE POLICY` (no table drops)
- Safe on **empty** and **existing production** databases

It includes tables, enums, indexes, foreign keys, functions, grants, triggers, and RLS policies matching the **production export** (`production-export.json`), not reconstructed from `types.ts` alone.

Later migrations remain for historical ordering and incremental hardening (notably `20260827230000_lock_role_probe_to_caller.sql`).

## Production rollout (manual — do not auto-deploy)

1. **Review** the baseline SQL in a staging clone or read-only review window.
2. **Apply manually** via Supabase SQL editor or `psql` (not Lovable auto-migrate):
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql
   ```
3. **Apply pending incremental migrations** if not already on production (especially role-probe lock):
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/20260827230000_lock_role_probe_to_caller.sql
   ```
4. **Do not** run `supabase db push` or Lovable schema deploy without explicit owner approval.

## Verification queries

Run after rollout:

```sql
-- Tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;

-- Enums
SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
GROUP BY 1 ORDER BY 1;

-- RLS enabled
SELECT relname, relrowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND relkind = 'r'
ORDER BY 1;

-- Policies
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public' ORDER BY 1, 2;

-- Role probes locked to caller (post 27230000)
SELECT pg_get_functiondef(p.oid) LIKE '%_user_id = auth.uid()%' AS caller_locked, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('has_role', 'is_staff');
```

Expected: 10 public tables, 13 enums, 12 staff/owner policies, `caller_locked = true` for both role probes after lock migration.

## Regenerate Supabase types

Requires [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
# Local (after supabase start && supabase db reset)
npm run db:types:local

# Linked remote project
npm run db:types
```

Commit `src/integrations/supabase/types.ts` when it changes.

## Tests

| Command | What it checks |
|---------|----------------|
| `npm test` | Static baseline coverage + auth tests (always) |
| `npm run test:migrations:local` | `supabase db reset` on clean DB + type diff (when CLI available) |

Static tests assert baseline SQL covers production inventory and that `Constants.public.Enums` matches `production-inventory.json`.

## Rollback limitations

- **No automatic down migration.** Baseline uses `IF NOT EXISTS` and `OR REPLACE`; it does not drop objects.
- **Policies/functions** replaced by baseline or later migrations can be reverted only by applying a forward fix migration — restoring prior function bodies requires a new SQL script.
- **Data is never deleted** by the baseline; rollback of schema objects on production with live data is high-risk and not supported by this ticket.
- If rollout fails mid-file, inspect `supabase_migrations.schema_migrations` (if used) or migration audit table and re-run from the failing statement after fixing the error — do not drop live tables.
