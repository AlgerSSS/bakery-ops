#!/bin/bash
set -euo pipefail
umask 077

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DESTINATION="${1:-}"
RUNNER_SOURCE="${2:-}"
WRAPPER_SOURCE="$SERVICE_DIR/deploy/HotCrushR6BrainIngest.c"
INFO_SOURCE="$SERVICE_DIR/deploy/HotCrushR6BrainIngest-Info.plist"
CLANG="${HOTCRUSH_CLANG:-$(xcrun --find clang)}"
SDKROOT="${HOTCRUSH_SDKROOT:-$(xcrun --sdk macosx --show-sdk-path)}"
CODESIGN="${HOTCRUSH_CODESIGN:-/usr/bin/codesign}"
APP_TRASH_DIR="${HOTCRUSH_APP_TRASH_DIR:-/Users/weiliangshao/.Trash}"

[[ -n "$APP_DESTINATION" && -n "$RUNNER_SOURCE" ]] || {
  echo "usage: $0 APP_DESTINATION RUNNER_SOURCE" >&2
  exit 64
}
[[ -x "$RUNNER_SOURCE" ]] || {
  echo "R6 ingest runner is not executable" >&2
  exit 65
}

build_hash=$(
  /usr/bin/shasum -a 256 "$SERVICE_DIR/build-brain-ingest-app.sh" \
    "$WRAPPER_SOURCE" "$INFO_SOURCE" "$RUNNER_SOURCE" |
    awk '{print $1}' |
    /usr/bin/shasum -a 256 |
    awk '{print $1}'
)
existing_hash="$APP_DESTINATION/Contents/Resources/build.sha256"
if [[ -f "$existing_hash" ]] &&
  [[ "$(<"$existing_hash")" == "$build_hash" ]] &&
  "$CODESIGN" --verify --deep --strict "$APP_DESTINATION" 2>/dev/null; then
  echo "dedicated R6 ingest app is current"
  exit 0
fi

temporary_dir=$(mktemp -d)
temporary_app="$temporary_dir/$(basename "$APP_DESTINATION")"
cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

mkdir -p "$temporary_app/Contents/MacOS" "$temporary_app/Contents/Resources"
/usr/bin/install -m 0644 "$INFO_SOURCE" "$temporary_app/Contents/Info.plist"
/usr/bin/install -m 0755 "$RUNNER_SOURCE" \
  "$temporary_app/Contents/Resources/run-brain-auto-ingest.sh"
printf '%s\n' "$build_hash" >"$temporary_app/Contents/Resources/build.sha256"

"$CLANG" -O2 -Wall -Wextra -Werror -isysroot "$SDKROOT" -mmacosx-version-min=13.0 \
  "$WRAPPER_SOURCE" \
  -o "$temporary_app/Contents/MacOS/HotCrushR6BrainIngest"
"$CODESIGN" --force --deep --sign - "$temporary_app" >/dev/null
"$CODESIGN" --verify --deep --strict "$temporary_app"

mkdir -p "$(dirname "$APP_DESTINATION")"
if [[ -e "$APP_DESTINATION" ]]; then
  mkdir -p "$APP_TRASH_DIR"
  previous="$APP_TRASH_DIR/$(basename "$APP_DESTINATION").$(date -u +%Y%m%dT%H%M%SZ).$$"
  mv "$APP_DESTINATION" "$previous"
fi
mv "$temporary_app" "$APP_DESTINATION"
echo "dedicated R6 ingest app built and signed"
