#!/bin/bash
set -euo pipefail

LABEL="com.hotcrush.r6-brain-ingest"
DOMAIN="${HOTCRUSH_LAUNCH_DOMAIN:-gui/$(id -u)}"
ROOT="${HOTCRUSH_ROOT:-/Users/weiliangshao/hot}"
SOURCE="${HOTCRUSH_LAUNCH_SOURCE:-$ROOT/bakery-ops/services/data-platform/deploy/$LABEL.plist}"
RUNNER="${HOTCRUSH_RUNNER:-$ROOT/bakery-ops/services/data-platform/run-brain-auto-ingest.sh}"
DESTINATION="${HOTCRUSH_LAUNCH_DESTINATION:-/Users/weiliangshao/Library/LaunchAgents/$LABEL.plist}"
TRASH_DIR="${HOTCRUSH_TRASH_DIR:-/Users/weiliangshao/.Trash}"
LOG_DIR="${HOTCRUSH_LOG_DIR:-/Users/weiliangshao/Library/Logs}"
STDOUT_LOG="$LOG_DIR/hotcrush-r6-brain-ingest.out.log"
STDERR_LOG="$LOG_DIR/hotcrush-r6-brain-ingest.err.log"
LAUNCHCTL="${HOTCRUSH_LAUNCHCTL:-/bin/launchctl}"
SECURITY="${HOTCRUSH_SECURITY:-/usr/bin/security}"
APP_BUILDER="${HOTCRUSH_APP_BUILDER:-$ROOT/bakery-ops/services/data-platform/build-brain-ingest-app.sh}"
APP_DESTINATION="${HOTCRUSH_APP_DESTINATION:-/Users/weiliangshao/Applications/HotCrush R6 Brain Ingest.app}"
VERIFY_TIMEOUT_SECONDS="${HOTCRUSH_VERIFY_TIMEOUT_SECONDS:-330}"
VERIFY_POLL_SECONDS="${HOTCRUSH_VERIFY_POLL_SECONDS:-1}"
ACTION="${1:-install}"
ROLLBACK_REQUIRED=false

move_agent_to_trash() {
  if [[ ! -e "$DESTINATION" ]]; then
    return
  fi
  mkdir -p "$TRASH_DIR"
  local trash_target="$TRASH_DIR/$LABEL.plist"
  if [[ -e "$trash_target" ]]; then
    trash_target="$TRASH_DIR/$LABEL.$(date -u +%Y%m%dT%H%M%SZ).$$.plist"
  fi
  mv "$DESTINATION" "$trash_target"
}

rollback_install() {
  "$LAUNCHCTL" bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  move_agent_to_trash
}

rotate_log() {
  local log_path="$1"
  if [[ -e "$log_path" ]]; then
    mv "$log_path" "$log_path.$(date -u +%Y%m%dT%H%M%SZ).$$"
  fi
  : >"$log_path"
  chmod 0600 "$log_path"
}

cleanup_on_exit() {
  local status=$?
  if [[ "$ROLLBACK_REQUIRED" == true && "$status" -ne 0 ]]; then
    rollback_install
  fi
}

wait_for_first_run() {
  local deadline=$((SECONDS + VERIFY_TIMEOUT_SECONDS))
  local output
  local state
  local last_exit
  while ((SECONDS <= deadline)); do
    if output=$("$LAUNCHCTL" print "$DOMAIN/$LABEL" 2>/dev/null); then
      state=$(awk -F'= ' '/^[[:space:]]*state = / { print $2; exit }' <<<"$output")
      if [[ "$state" == "not running" ]]; then
        last_exit=$(awk -F'= ' '/^[[:space:]]*last exit code = / { print $2; exit }' <<<"$output")
        last_exit="${last_exit%%:*}"
        if [[ "$last_exit" =~ ^[0-9]+$ ]]; then
          return "$last_exit"
        fi
      fi
    fi
    sleep "$VERIFY_POLL_SECONDS"
  done
  return 124
}

trap cleanup_on_exit EXIT

if [[ "$ACTION" == "uninstall" ]]; then
  "$LAUNCHCTL" bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  move_agent_to_trash
  echo "$LABEL uninstalled; R6 data and local state were retained"
  exit 0
fi

[[ "$ACTION" == "install" ]] || {
  echo "usage: $0 [install|uninstall]" >&2
  exit 64
}
[[ "$VERIFY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || {
  echo "verify timeout must be a positive integer" >&2
  exit 64
}
[[ -x "$RUNNER" ]] || {
  echo "runner is not executable: $RUNNER" >&2
  exit 65
}
[[ -x "$APP_BUILDER" ]] || {
  echo "app builder is not executable: $APP_BUILDER" >&2
  exit 65
}
/usr/bin/plutil -lint "$SOURCE" >/dev/null
"$SECURITY" find-generic-password \
  -a weiliangshao \
  -s hotcrush-core-r6-green-secret-key >/dev/null
"$APP_BUILDER" "$APP_DESTINATION" "$RUNNER"

mkdir -p "$(dirname "$DESTINATION")" "$LOG_DIR"
"$LAUNCHCTL" bootout "$DOMAIN/$LABEL" 2>/dev/null || true
rotate_log "$STDOUT_LOG"
rotate_log "$STDERR_LOG"
/usr/bin/install -m 0644 "$SOURCE" "$DESTINATION"
"$LAUNCHCTL" bootstrap "$DOMAIN" "$DESTINATION"
"$LAUNCHCTL" enable "$DOMAIN/$LABEL"
ROLLBACK_REQUIRED=true
if wait_for_first_run; then
  ROLLBACK_REQUIRED=false
  echo "$LABEL installed; first background run exited 0"
else
  status=$?
  if [[ "$status" -eq 77 ]]; then
    echo "first background run failed the Brain access probe; grant Full Disk Access and retry" >&2
  elif [[ "$status" -eq 124 ]]; then
    echo "first background run did not finish before the verification timeout" >&2
  else
    echo "first background run failed with exit code $status" >&2
  fi
  exit "$status"
fi
