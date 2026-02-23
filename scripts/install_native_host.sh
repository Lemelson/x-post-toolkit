#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_NAME="com.xvdl.transcriber"
INSTALL_DIR="$HOME/.local/share/xvdl"
BIN_DIR="$HOME/.local/bin"
HOST_SCRIPT_SRC="$PROJECT_DIR/scripts/native_host.py"
HOST_SCRIPT_DST="$INSTALL_DIR/native_host.py"
WRAPPER_PATH="$BIN_DIR/xvdl-native-host"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"
FFMPEG_BIN="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
PARAKEET_BIN="${PARAKEET_BIN:-$(command -v parakeet-mlx || true)}"

detect_extension_ids() {
  python3 - "$PROJECT_DIR" <<'PY'
import json
import os
import sys
from pathlib import Path

project = os.path.realpath(sys.argv[1])
bases = [
    Path.home() / "Library/Application Support/Comet",
    Path.home() / "Library/Application Support/Google/Chrome",
    Path.home() / "Library/Application Support/Arc/User Data",
    Path.home() / "Library/Application Support/BraveSoftware/Brave-Browser",
    Path.home() / "Library/Application Support/Microsoft Edge",
    Path.home() / "Library/Application Support/Vivaldi",
    Path.home() / "Library/Application Support/Chromium",
    Path.home() / "Library/Application Support/com.operasoftware.Opera",
]

ids = set()
for base in bases:
    if not base.exists():
        continue
    pref_files = list(base.glob("*/Preferences")) + list(base.glob("*/Secure Preferences"))
    for prefs in pref_files:
        try:
            data = json.loads(prefs.read_text(encoding="utf-8"))
        except Exception:
            continue
        settings = data.get("extensions", {}).get("settings", {})
        for ext_id, meta in settings.items():
            ext_path = meta.get("path")
            if not ext_path:
                continue
            try:
                if os.path.realpath(ext_path) == project:
                    ids.add(ext_id)
            except Exception:
                pass

for ext_id in sorted(ids):
    print(ext_id)
PY
}

collect_native_host_dirs() {
  python3 <<'PY'
from pathlib import Path

dirs = [
    Path.home() / "Library/Application Support/Comet/NativeMessagingHosts",
    Path.home() / "Library/Application Support/Comet/User Data/NativeMessagingHosts",
    Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    Path.home() / "Library/Application Support/Arc/User Data/NativeMessagingHosts",
    Path.home() / "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    Path.home() / "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
    Path.home() / "Library/Application Support/Vivaldi/NativeMessagingHosts",
    Path.home() / "Library/Application Support/Chromium/NativeMessagingHosts",
    Path.home() / "Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts",
]

for d in dirs:
    print(str(d))
PY
}

EXTENSION_IDS=()
if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    [[ -n "$arg" ]] && EXTENSION_IDS+=("$arg")
  done
fi

if [[ ${#EXTENSION_IDS[@]} -eq 0 ]]; then
  while IFS= read -r id; do
    [[ -n "$id" ]] && EXTENSION_IDS+=("$id")
  done < <(detect_extension_ids)
fi

if [[ ${#EXTENSION_IDS[@]} -eq 0 ]]; then
  cat >&2 <<EOF
Could not auto-detect unpacked extension ID.
Open browser://extensions, copy this extension ID, then run:
  $(basename "$0") <extension_id>
EOF
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
cp "$HOST_SCRIPT_SRC" "$HOST_SCRIPT_DST"
chmod +x "$HOST_SCRIPT_DST"

cat >"$WRAPPER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export XVDL_FFMPEG_BIN="${FFMPEG_BIN:-ffmpeg}"
export XVDL_PARAKEET_BIN="${PARAKEET_BIN:-parakeet-mlx}"
exec "${PYTHON_BIN}" -B "${HOST_SCRIPT_DST}"
EOF
chmod +x "$WRAPPER_PATH"

origins_json=""
for id in "${EXTENSION_IDS[@]}"; do
  if [[ -n "$origins_json" ]]; then
    origins_json+=", "
  fi
  origins_json+="\"chrome-extension://${id}/\""
done

written=0
while IFS= read -r dir; do
  [[ -z "$dir" ]] && continue
  mkdir -p "$dir"
  manifest_path="$dir/${HOST_NAME}.json"
  cat >"$manifest_path" <<EOF
{
  "name": "${HOST_NAME}",
  "description": "X video transcript native host",
  "path": "${WRAPPER_PATH}",
  "type": "stdio",
  "allowed_origins": [
    ${origins_json}
  ]
}
EOF
  echo "Installed: $manifest_path"
  written=$((written + 1))
done < <(collect_native_host_dirs)

echo
echo "Extension IDs allowed:"
for id in "${EXTENSION_IDS[@]}"; do
  echo "  $id"
done

echo
echo "Wrapper path:"
echo "  $WRAPPER_PATH"
echo
echo "Native manifests written: $written"
