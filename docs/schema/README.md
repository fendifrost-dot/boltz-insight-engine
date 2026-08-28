# Schema baseline and reproducibility

## Problem

Production lead-inbox schema was applied through Lovable Cloud before the full DDL existed in git. The earliest checked-in migration grants on nine tables that no migration created, so a **fresh database fails immediately**.

## Authoritative sources

| Source | Role |
|--------|------|
| `docs/schema/production-export.json` | **Read-only export** from live production (`query_database`): columns, defaults, constraints, indexes, FKs, RLS state, policies, triggers, function definitions, enums |
| `docs/schema/production-inventory.json` | Curated pointer into the export for static tests |
| `supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql` | Lead-inbox foundation baseline only |
| `src/integrations/supabase/types.ts` | Generated client types (enums/tables; not sufficient alone) |

## Baseline migration scope

`20260825155900_baseline_ops_schema_adoption.sql` recreates the **pre-existing lead-inbox foundation** that later migrations assumed:

- Nine lead-inbox tables, twelve enums, indexes, FKs/checks, helper functions, triggers
- `ENABLE ROW LEVEL SECURITY` on lead-inbox tables (**policies are not created here**)
- **Does not** create `app_role`, `user_roles`, role probes, staff policies, or grants

Those are owned by later migrations:

| Migration | Purpose |
|-----------|---------|
| `20260825165448_…` | Grants |
| `20260825165502_…` | Trigger function bodies refresh |
| `20260826001442_…` | Auth roles, staff RLS policies |
| `20260826001500_…` | Role probe execute grants |
| `20260827230000_…` | Caller-locked role probes |

### Idempotency guarantees

- Enums: `DO $$ … EXCEPTION WHEN duplicate_object`
- Tables/indexes: `IF NOT EXISTS`
- Triggers: `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`
- Functions: `CREATE OR REPLACE`
- No `DROP TABLE`, no policy churn, no insecure role-probe recreation

Safe on **empty DB** (bootstrap) and **existing production adoption** (re-run).

## Tests

| Command | Behavior |
|---------|----------|
| `npm test` | Static baseline/export checks (always) |
| `npm run test:migrations` | **Real PostgreSQL** integration tests; **fails** if `psql`/PostgreSQL unavailable. Defaults to local Ubuntu (`sudo -u postgres` when `PGUSER=postgres`); set `PGHOST`/`PGUSER`/`PGPASSWORD` for remote CI. |
| `npm run test:migrations:local` | Uses Supabase CLI when present; otherwise runs PostgreSQL tests |

PostgreSQL integration tests verify:

1. Complete migration chain on an empty database
2. Baseline re-apply on a production-shaped schema (after full chain)
3. Baseline executed twice without error
4. `has_role` / `is_staff` remain caller-locked after `20260827230000`

## Production rollout (manual — do not auto-deploy)

### Option A — Supabase migration history (preferred)

1. Review baseline SQL in staging.
2. Apply through Supabase migration tooling so history is recorded. Because this baseline predates migrations already applied remotely, use **`--include-all`** so the out-of-order version is included:
   ```bash
   supabase db push --linked --include-all
   ```
   Plain `supabase db push --linked` may skip `20260825155900` if it is missing from remote history.

### Option B — Manual SQL + history registration

If production already contains the objects and you apply SQL manually for verification:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260825155900_baseline_ops_schema_adoption.sql
```

Then register the migration so Supabase will not re-apply it:

```bash
supabase migration repair 20260825155900 --status applied --linked
```

**Do not** run manual SQL without registering the version — a later deploy will attempt the baseline again.

### Verification queries

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;

SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2;

SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2;

SELECT proname,
       pg_get_functiondef(p.oid) LIKE '%_user_id = auth.uid()%' AS caller_locked
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('has_role', 'is_staff');
```

Expected after full chain: nine lead-inbox tables, staff/owner policies from `20260826001442`, caller-locked role probes from `20260827230000`.

## Rollback limitations

- Baseline does not drop objects; rollback is forward-fix only.
- Re-running baseline on production is safe but replaces trigger definitions and function bodies.
- Do not drop live tables to “roll back.”

## Regenerate types

```bash
npm run db:types        # linked remote
npm run db:types:local  # local Supabase after db reset
```
