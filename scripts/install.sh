#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"
UUID="tiling-toggle@villa1337"

echo "Compiling schemas..."
glib-compile-schemas "$SRC_DIR/schemas/"

echo "Packing extension..."
rm -f /tmp/$UUID.shell-extension.zip
cd "$SRC_DIR"
zip -qr /tmp/$UUID.shell-extension.zip ./*
cd - >/dev/null

echo "Installing..."
gnome-extensions install --force /tmp/$UUID.shell-extension.zip
rm -f /tmp/$UUID.shell-extension.zip

echo "Done. Enable with:"
echo "  gnome-extensions enable $UUID"
echo ""
echo "If already enabled, restart GNOME Shell (log out/in on Wayland) to pick up changes."
