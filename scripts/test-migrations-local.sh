#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v supabase >/dev/null 2>&1; then
  echo "SKIP: supabase CLI not installed. Install from https://supabase.com/docs/guides/cli"
  echo "Then run: supabase start && supabase db reset && npm test"
  exit 0
fi

echo "Applying all migrations on a clean local database..."
supabase db reset --yes

echo "Regenerating types (requires linked project or local)..."
if supabase gen types typescript --local > /tmp/generated-types.ts 2>/dev/null; then
  if diff -q /tmp/generated-types.ts src/integrations/supabase/types.ts >/dev/null; then
    echo "OK: generated types match committed types.ts"
  else
    echo "WARN: generated types differ from src/integrations/supabase/types.ts"
    echo "Review diff and run: npm run db:types"
    diff -u src/integrations/supabase/types.ts /tmp/generated-types.ts || true
    exit 1
  fi
else
  echo "SKIP: could not generate local types (supabase start may be required)"
fi

echo "Running unit + migration static tests..."
npm test

echo "Clean-database migration test passed."
