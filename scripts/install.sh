#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"
PROJECT_DIR="$SCRIPT_DIR/.."
UUID="tiling-toggle@villa1337"

case "${1:-install}" in
    zip)
        # Build EGO-ready zip (no gschemas.compiled)
        echo "Packing extension for EGO..."
        rm -f "$PROJECT_DIR/$UUID.zip"
        rm -f "$SRC_DIR/schemas/gschemas.compiled"
        cd "$SRC_DIR"
        zip -qr "$PROJECT_DIR/$UUID.zip" ./* -x "schemas/gschemas.compiled"
        cd - >/dev/null
        echo "Created: $PROJECT_DIR/$UUID.zip"
        ;;
    install|*)
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

        # Don't leave compiled schema in source tree
        rm -f "$SRC_DIR/schemas/gschemas.compiled"

        echo "Done. Enable with:"
        echo "  gnome-extensions enable $UUID"
        echo ""
        echo "If already enabled, restart GNOME Shell (log out/in on Wayland) to pick up changes."
        ;;
esac
