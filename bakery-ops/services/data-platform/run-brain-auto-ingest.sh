#!/bin/bash
set -euo pipefail
umask 077

ROOT="${HOTCRUSH_ROOT:-/Users/weiliangshao/hot}"
SERVICE_DIR="${HOTCRUSH_SERVICE_DIR:-$ROOT/bakery-ops/services/data-platform}"
BRAIN_ROOT="${HOTCRUSH_BRAIN_ROOT:-/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw}"
STATE_FILE="${HOTCRUSH_AUTO_STATE_FILE:-/Users/weiliangshao/Library/Application Support/HotCrush/r6-rag/auto-ingest/state.json}"
UV="${HOTCRUSH_UV:-/Users/weiliangshao/.local/bin/uv}"
SECURITY="${HOTCRUSH_SECURITY:-/usr/bin/security}"
PERL="${HOTCRUSH_PERL:-/usr/bin/perl}"
ACCESS_TIMEOUT_SECONDS="${HOTCRUSH_ACCESS_TIMEOUT_SECONDS:-20}"
AUTO_TIMEOUT_SECONDS="${HOTCRUSH_AUTO_TIMEOUT_SECONDS:-300}"

[[ -d "$BRAIN_ROOT" ]] || {
  echo "Brain raw directory is unavailable" >&2
  exit 66
}
[[ -x "$UV" ]] || {
  echo "uv executable is unavailable" >&2
  exit 69
}
[[ "$ACCESS_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || {
  echo "access timeout must be a positive integer" >&2
  exit 64
}
[[ "$AUTO_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || {
  echo "auto timeout must be a positive integer" >&2
  exit 64
}

cd "$SERVICE_DIR"
if "$PERL" -e 'alarm shift @ARGV; exec @ARGV or die "exec failed: $!\n"' \
  "$ACCESS_TIMEOUT_SECONDS" \
  "$UV" run --frozen brainctl probe "$BRAIN_ROOT"; then
  :
else
  echo "Brain background access probe failed; grant Full Disk Access before installing" >&2
  exit 77
fi

r6_secret=$("$SECURITY" find-generic-password \
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

exec "$PERL" -e 'alarm shift @ARGV; exec @ARGV or die "exec failed: $!\n"' \
  "$AUTO_TIMEOUT_SECONDS" \
  "$UV" run --frozen brainctl auto \
  "$BRAIN_ROOT" \
  --state-file "$STATE_FILE" \
  --apply
