#!/bin/bash
set -euo pipefail

LABEL="com.hotcrush.r6-brain-ingest"
DOMAIN="gui/$(id -u)"
ROOT="/Users/weiliangshao/hot"
SOURCE="$ROOT/bakery-ops/services/data-platform/deploy/$LABEL.plist"
RUNNER="$ROOT/bakery-ops/services/data-platform/run-brain-auto-ingest.sh"
DESTINATION="/Users/weiliangshao/Library/LaunchAgents/$LABEL.plist"
ACTION="${1:-install}"

if [[ "$ACTION" == "uninstall" ]]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  if [[ -e "$DESTINATION" ]]; then
    mv "$DESTINATION" "/Users/weiliangshao/.Trash/$LABEL.plist"
  fi
  echo "$LABEL uninstalled; R6 data and local state were retained"
  exit 0
fi

[[ "$ACTION" == "install" ]] || {
  echo "usage: $0 [install|uninstall]" >&2
  exit 64
}
[[ -x "$RUNNER" ]] || {
  echo "runner is not executable: $RUNNER" >&2
  exit 65
}
/usr/bin/plutil -lint "$SOURCE" >/dev/null
/usr/bin/security find-generic-password \
  -a weiliangshao \
  -s hotcrush-core-r6-green-secret-key >/dev/null

mkdir -p /Users/weiliangshao/Library/LaunchAgents /Users/weiliangshao/Library/Logs
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
/usr/bin/install -m 0644 "$SOURCE" "$DESTINATION"
launchctl bootstrap "$DOMAIN" "$DESTINATION"
launchctl enable "$DOMAIN/$LABEL"
echo "$LABEL installed; RunAtLoad started the first scan"
