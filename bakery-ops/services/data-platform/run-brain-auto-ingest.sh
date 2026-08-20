#!/bin/bash
set -euo pipefail
umask 077

ROOT="/Users/weiliangshao/hot"
SERVICE_DIR="$ROOT/bakery-ops/services/data-platform"
BRAIN_ROOT="/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw"
STATE_FILE="/Users/weiliangshao/Library/Application Support/HotCrush/r6-rag/auto-ingest/state.json"
UV="/Users/weiliangshao/.local/bin/uv"

[[ -d "$BRAIN_ROOT" ]] || {
  echo "Brain raw directory is unavailable" >&2
  exit 66
}
[[ -x "$UV" ]] || {
  echo "uv executable is unavailable" >&2
  exit 69
}

r6_secret=$(/usr/bin/security find-generic-password \
  -a weiliangshao \
  -s hotcrush-core-r6-green-secret-key \
  -w)
[[ -n "$r6_secret" ]] || {
  echo "R6 Keychain credential is unavailable" >&2
  exit 65
}

export R6_SUPABASE_URL="https://tmmkknnkcptunxbfjxqn.supabase.co"
export R6_SUPABASE_SERVICE_KEY="$r6_secret"
unset r6_secret

cd "$SERVICE_DIR"
exec /usr/bin/perl -e 'alarm shift @ARGV; exec @ARGV or die "exec failed: $!\n"' \
  300 \
  "$UV" run --frozen brainctl auto \
  "$BRAIN_ROOT" \
  --state-file "$STATE_FILE" \
  --apply
