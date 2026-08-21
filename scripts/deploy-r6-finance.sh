#!/bin/bash
# Deploy the R6 finance domain and migrate the legacy finance data into it.
#
# Every step below was already run end to end against a local Supabase using real production
# data, and reconciled to zero mismatch. This script performs the same four steps against the
# isolated R6 project. It is the only part that needs a remote schema change, which is why it
# is a separate, explicit script rather than something buried in the acceptance run.
#
# What this touches:
#   R6 project tmmkknnkcptunxbfjxqn  - applies migrations, writes finance facts
#   old production ecsgqcmwtjmcpzqytdqw - READ ONLY, inside an explicit read-only transaction
#
# What this does NOT touch: the finance site, its DATABASE_URL, Vercel variables, BakeryOps
# knowledge backend, or any existing production data.
#
# Usage:
#   ./scripts/deploy-r6-finance.sh --dry-run   # show what would happen, change nothing
#   ./scripts/deploy-r6-finance.sh             # deploy, migrate, reconcile
set -euo pipefail

ROOT="/Users/weiliangshao/hot"
R6_REF="tmmkknnkcptunxbfjxqn"
OLD_REF="ecsgqcmwtjmcpzqytdqw"
SUPABASE=(npx --yes supabase@2.115.0)
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "usage: $0 [--dry-run]" >&2; exit 64 ;;
  esac
done

step() { printf '\n=== %s\n' "$1"; }

# --- Guard: never run this against anything but the isolated R6 project ----------------------
step "guard: project isolation"
linked_ref=$(tr -d '\r\n' < "$ROOT/supabase/.temp/project-ref")
[[ "$linked_ref" == "$R6_REF" ]] || {
  echo "linked Supabase project is $linked_ref, not R6 ($R6_REF); refusing to deploy" >&2
  exit 65
}
for config_file in "$ROOT/bakery-ops/.env" "$ROOT/res_api/.env"; do
  rg -q "$OLD_REF" "$config_file" || {
    echo "old application config no longer points at old production: $config_file" >&2
    exit 65
  }
  if rg -q "$R6_REF" "$config_file"; then
    echo "R6 ref must not be written into old application config: $config_file" >&2
    exit 65
  fi
done
echo "ok: linked to R6; old application configs still point at old production"

# --- Credentials ------------------------------------------------------------------------------
step "guard: credentials"
R6_KEY="${R6_SUPABASE_SERVICE_KEY:-}"
if [[ -z "$R6_KEY" ]]; then
  R6_KEY=$(security find-generic-password -a weiliangshao -s hotcrush-core-r6-green-secret-key -w)
fi
[[ -n "$R6_KEY" ]] || { echo "R6 service key not available" >&2; exit 65; }
export R6_SUPABASE_URL="https://$R6_REF.supabase.co"
export R6_SUPABASE_SERVICE_KEY="$R6_KEY"
export R6_SUPABASE_SECRET_KEY="$R6_KEY"
echo "ok: R6 credentials resolved (not printed)"

# --- Show what is pending ---------------------------------------------------------------------
step "pending migrations"
pending=$(cd "$ROOT" && "${SUPABASE[@]}" migration list --linked \
  | jq -r '.migrations[] | select(.remote == "") | .local')
if [[ -z "$pending" ]]; then
  echo "no pending migrations; schema already deployed"
else
  echo "$pending" | sed 's/^/  will apply: /'
fi

if [[ "$DRY_RUN" == "1" ]]; then
  step "dry run"
  echo "would apply the migrations above, then:"
  echo "  1. node res_api/scripts/backfill-r6-finance.js --r6-store=HC001"
  echo "  2. python -m hotcrush_data_platform.finance_worker --max-runs 5"
  echo "  3. node res_api/scripts/verify-r6-finance.js   (must report ok: true)"
  echo
  echo "reading legacy finance row counts (read-only, nothing is written):"
  (cd "$ROOT/res_api" && node scripts/backfill-r6-finance.js --r6-store=HC001 --dry-run)
  exit 0
fi

# --- 1. Schema --------------------------------------------------------------------------------
step "1/4 apply migrations to R6"
(cd "$ROOT" && "${SUPABASE[@]}" db push --linked --yes)

# --- 2. Export legacy finance data into immutable Raw batches ----------------------------------
step "2/4 register finance Raw batches"
(cd "$ROOT/res_api" && node scripts/backfill-r6-finance.js --r6-store=HC001)

# --- 3. Load the batches through the controlled RPCs under a lease -----------------------------
step "3/4 load finance facts"
(cd "$ROOT/bakery-ops/services/data-platform" \
  && POS_WORKER_ID="${POS_WORKER_ID:-finance-migration}" \
     uv run python -m hotcrush_data_platform.finance_worker --max-runs 5)

# --- 4. Reconcile against legacy production ----------------------------------------------------
# Compares row count AND summed amount per domain. A load that zeroed every value would still
# match on counts alone, so counts by themselves are not an acceptance criterion.
step "4/4 reconcile against legacy production"
(cd "$ROOT/res_api" && node scripts/verify-r6-finance.js)

step "done"
echo "R6 finance domain deployed and reconciled."
echo "Old production was read only; the finance site is untouched and still on the old database."
