#!/usr/bin/env bash
# Optional Supabase CLI path. Never exits 0 when required tooling is missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if command -v supabase >/dev/null 2>&1; then
  echo "Applying migrations with Supabase CLI (supabase db reset)..."
  supabase db reset --yes
  npm test
  echo "Supabase local migration test passed."
  exit 0
fi

echo "Supabase CLI unavailable; falling back to PostgreSQL integration tests." >&2
exec bash scripts/test-migrations-postgres.sh
