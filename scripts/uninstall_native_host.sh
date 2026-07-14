#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.xvdl.transcriber"
INSTALL_DIR="$HOME/.local/share/xvdl"
BIN_DIR="$HOME/.local/bin"
WRAPPER_PATH="$BIN_DIR/xvdl-native-host"
HOST_SCRIPT_DST="$INSTALL_DIR/native_host.py"
COMPAT_SCRIPT_DST="$INSTALL_DIR/spokenly_parakeet_compat.py"
COMPAT_WRAPPER_PATH="$BIN_DIR/parakeet-mlx"

paths=(
  "$HOME/Library/Application Support/net.imput.helium/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/Comet/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/Comet/User Data/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/${HOST_NAME}.json"
  "$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts/${HOST_NAME}.json"
)

for p in "${paths[@]}"; do
  rm -f "$p"
done

if grep -qF "$COMPAT_SCRIPT_DST" "$COMPAT_WRAPPER_PATH" 2>/dev/null; then
  rm -f "$COMPAT_WRAPPER_PATH"
fi
rm -f "$WRAPPER_PATH" "$HOST_SCRIPT_DST" "$COMPAT_SCRIPT_DST"
rmdir "$INSTALL_DIR" 2>/dev/null || true

echo "Removed native host manifests and binaries."
